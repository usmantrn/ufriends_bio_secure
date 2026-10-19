const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticateAgentToken } = require('../middleware/auth');
const logger = require('../lib/logger');

// ═══════════════════════════════════════════════════════════════════════════
// Palm Vein 1:N Deduplication Engine
// ─────────────────────────────────────────────────────────────────────────
// Implements the PDF's "1-to-N Multi-Identity Filtering Pipeline":
//
//   Stage 1 — Macro-geometric coarse filter
//     Uses vector[0..63] (8×8 grid means) for fast pre-screening.
//     Rejects candidates with Manhattan distance > COARSE_THRESHOLD quickly.
//     Reduces full cosine comparisons by ~85% at scale.
//
//   Stage 2 — Full cosine similarity
//     Compares complete 256-dim L2-normalised vector against candidates.
//     Threshold: similarity > 0.82 → duplicate.
//
// At < 1,000 citizens (demo scale): both stages run in < 5ms in Postgres.
// At national scale: replace Stage 2 with FAISS/Milvus cluster.
// ═══════════════════════════════════════════════════════════════════════════

const COARSE_THRESHOLD   = 1.2;   // Manhattan distance on [0..63] for fast reject
const COSINE_THRESHOLD   = 0.70;  // Tuned for visible-light simulation
                                   // (NIR hardware: raise back to 0.82)
const COARSE_DIMS        = 64;    // Macro-geometric slice (first 64 of 298-dim vector)
const VECTOR_DIM         = 298;   // HOG(256) + Geometric landmarks(42)
const TOP_N              = 5;     // Return top-N candidates for review

/** Cosine similarity between two arrays (dot product of L2-normalised vecs) */
function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.max(-1, Math.min(1, dot));
}

/** Manhattan distance on first COARSE_DIMS elements (coarse filter) */
function coarseDist(a, b) {
  let d = 0;
  for (let i = 0; i < COARSE_DIMS; i++) d += Math.abs(a[i] - b[i]);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/palm/dedup-check
// Body: { template: number[256], side: 'Right'|'Left', excludeCitizenId?: string }
// Returns: { isDuplicate, matches: [{ citizenId, name, similarity, side }], processingMs }
// ─────────────────────────────────────────────────────────────────────────
router.post('/dedup-check', authenticateAgentToken, async (req, res) => {
  const t0 = Date.now();
  try {
    const { template, side = 'Right', excludeCitizenId } = req.body;

    if (!Array.isArray(template) || template.length !== VECTOR_DIM) {
      return res.status(400).json({ error: `template must be a ${VECTOR_DIM}-element float array (got ${template?.length})` });
    }

    // Primary field: rightPalmVeinTemplate (256-dim NIR vector from PalmVeinExtractor)
    // Fallback:      rightPalmVisible (used when NIR camera not available)
    const fieldNir     = 'rightPalmVeinTemplate';
    const fieldVisible = 'rightPalmVisible';
    const fieldNirL    = 'leftPalmVeinTemplate';
    const fieldVisL    = 'leftPalmVisible';

    const primaryField  = side === 'Right' ? fieldNir     : fieldNirL;
    const fallbackField = side === 'Right' ? fieldVisible : fieldVisL;

    const citizens = await prisma.citizen.findMany({
      where: {
        id: excludeCitizenId ? { not: excludeCitizenId } : undefined,
        enrollmentStatus: { not: 'QUARANTINED' },
      },
      select: {
        id: true,
        fullName: true,
        [primaryField]:  true,
        [fallbackField]: true,
      },
    });

    if (citizens.length === 0) {
      return res.json({
        isDuplicate: false,
        matches: [],
        processingMs: Date.now() - t0,
        scanned: 0,
        message: 'No enrolled palm templates to compare against.',
      });
    }

    // ── Stage 1: Macro-geometric coarse filter ────────────────────────────
    // Use first 64 dims (the 8×8 grid macro-geometric index) for fast pre-screening
    const coarsePassed = citizens.filter(c => {
      // Prefer NIR template; fall back to visible
      const stored = (c[primaryField]?.length >= COARSE_DIMS)
        ? c[primaryField]
        : c[fallbackField];
      if (!stored || stored.length < COARSE_DIMS) return false;
      return coarseDist(template, stored) <= COARSE_THRESHOLD;
    });

    logger.info(`Palm dedup: ${citizens.length} total → ${coarsePassed.length} passed coarse filter (side=${side})`);

    // ── Stage 2: Full 256-dim cosine similarity ───────────────────────────
    const scored = coarsePassed.map(c => {
      const stored = (c[primaryField]?.length === 256)
        ? c[primaryField]
        : c[fallbackField];
      return {
        citizenId:  c.id,
        name:       c.fullName,
        side,
        similarity: cosineSim(template, stored),
      };
    });

    // Sort descending by similarity
    scored.sort((a, b) => b.similarity - a.similarity);

    const topMatches = scored.slice(0, TOP_N);
    const isDuplicate = topMatches.length > 0 && topMatches[0].similarity >= COSINE_THRESHOLD;

    const processingMs = Date.now() - t0;
    logger.info(`Palm dedup complete: isDuplicate=${isDuplicate}, best=${topMatches[0]?.similarity?.toFixed(4)}, ms=${processingMs}`);

    return res.json({
      isDuplicate,
      threshold: COSINE_THRESHOLD,
      matches: topMatches,
      scanned:  citizens.length,
      coarsePassed: coarsePassed.length,
      processingMs,
    });

  } catch (err) {
    logger.error('Palm dedup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/palm/stats
// Returns aggregate stats on palm template quality / coverage
// ─────────────────────────────────────────────────────────────────────────
router.get('/stats', authenticateAgentToken, async (req, res) => {
  try {
    const [total, withRight, withLeft, withBoth] = await Promise.all([
      prisma.citizen.count(),
      prisma.citizen.count({ where: { rightPalmVisible: { isEmpty: false } } }),
      prisma.citizen.count({ where: { leftPalmVisible:  { isEmpty: false } } }),
      prisma.citizen.count({ where: {
        rightPalmVisible: { isEmpty: false },
        leftPalmVisible:  { isEmpty: false },
      }}),
    ]);

    res.json({
      totalCitizens:  total,
      withRightPalm:  withRight,
      withLeftPalm:   withLeft,
      withBothPalms:  withBoth,
      coveragePercent: total > 0 ? Math.round((withBoth / total) * 100) : 0,
      dedupConfig: {
        vectorDimensions:  VECTOR_DIM,
        hogDimensions:     256,
        geometryDimensions: 42,
        coarseDimensions:  COARSE_DIMS,
        cosineThreshold:   COSINE_THRESHOLD,
        coarseThreshold:   COARSE_THRESHOLD,
        algorithm:         'HOG(256) + MediaPipe geometry(42) cosine similarity',
        note:              'Threshold 0.70 for simulation; raise to 0.82 for real NIR',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
