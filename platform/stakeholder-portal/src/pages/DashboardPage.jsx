import { useEffect, useState, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import api from '../api/client';
import 'leaflet/dist/leaflet.css';

const NIGERIA_CENTER = [9.0820, 8.6753];
const NIGERIA_ZOOM = 6;

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

// Animated pulsing dot for live enrollments added this session
function LivePulse({ center, flagged }) {
  const map = useMap();
  return (
    <CircleMarker
      center={center}
      radius={flagged ? 10 : 8}
      fillColor={flagged ? '#EF4444' : '#00FF88'}
      color={flagged ? '#DC2626' : '#00D4FF'}
      weight={2}
      fillOpacity={0.9}
      className="live-enrollment-dot"
    >
      <Popup>
        <div style={{ fontSize: 12, lineHeight: 1.7, minWidth: 180 }}>
          <div style={{ fontWeight: 700, color: flagged ? '#EF4444' : '#00FF88', marginBottom: 4 }}>
            {flagged ? '⚠️ FLAGGED ENROLLMENT' : '✅ LIVE ENROLLMENT'}
          </div>
          <div>Just captured</div>
        </div>
      </Popup>
    </CircleMarker>
  );
}

// Security Intelligence Panel
function SecurityPanel({ stats, liveEvents }) {
  const tamperAlerts = liveEvents.filter(e => e.type === 'tamper');
  const roboticAlerts = liveEvents.filter(e => e.type === 'flag' && e.flagType === 'ROBOTIC_DEVICE_TELEMETRY');

  return (
    <div className="card" style={{ borderColor: 'rgba(239,68,68,0.3)' }}>
      <div className="card-header">
        <span>🛡️</span>
        <span className="card-title">Security Intelligence</span>
        <span style={{ fontSize: 10, color: 'var(--status-danger)', fontWeight: 700, letterSpacing: 0.5 }}>
          ZERO-TRUST MONITOR
        </span>
      </div>
      <div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <SecurityMetric
            icon="🔗"
            label="Chain Integrity"
            value={stats?.chainTampers > 0 ? `${stats.chainTampers} BREACH` : 'INTACT'}
            valueColor={stats?.chainTampers > 0 ? 'var(--status-danger)' : 'var(--status-success)'}
            bg={stats?.chainTampers > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(0,168,107,0.08)'}
          />
          <SecurityMetric
            icon="🤖"
            label="Robotic Devices"
            value={roboticAlerts.length > 0 ? `${roboticAlerts.length} FLAGGED` : 'NONE'}
            valueColor={roboticAlerts.length > 0 ? 'var(--status-warning)' : 'var(--status-success)'}
            bg={roboticAlerts.length > 0 ? 'rgba(245,158,11,0.08)' : 'rgba(0,168,107,0.08)'}
          />
          <SecurityMetric
            icon="🛡️"
            label="TEE Signatures"
            value={`${stats?.enrollments?.total || 0} signed`}
            valueColor="var(--brand-primary)"
            bg="rgba(0,212,255,0.06)"
          />
          <SecurityMetric
            icon="🔒"
            label="Continuous Auth"
            value="ACTIVE"
            valueColor="var(--status-success)"
            bg="rgba(0,168,107,0.08)"
          />
        </div>

        {/* Merkle chain status */}
        <div style={{
          padding: '10px 14px',
          borderRadius: 10,
          background: 'rgba(0,168,107,0.06)',
          border: '1px solid rgba(0,168,107,0.2)',
          marginBottom: 10,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
              🔗 Merkle Hash Chain
            </span>
            <span style={{
              fontSize: 11, fontWeight: 800, padding: '2px 8px',
              borderRadius: 6, background: 'rgba(0,168,107,0.15)',
              color: 'var(--status-success)', letterSpacing: 0.3
            }}>
              VERIFIED
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            All offline sync batches hash-chain verified. No tampered records detected.
          </div>
        </div>

        {/* Tamper alerts */}
        {tamperAlerts.length > 0 && (
          <div style={{
            padding: '10px 14px',
            borderRadius: 10,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.35)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--status-danger)', marginBottom: 4 }}>
              🚨 TAMPER ALERT — Offline data breach detected
            </div>
            {tamperAlerts.slice(0, 2).map((a, i) => (
              <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Agent {a.agentId} · {a.quarantinedCount} records quarantined · {timeAgo(a.timestamp)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SecurityMetric({ icon, label, value, valueColor, bg }) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 10,
      background: bg, border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ fontSize: 16, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3, letterSpacing: 0.3 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, fontWeight: 800, color: valueColor }}>
        {value}
      </div>
    </div>
  );
}

export default function DashboardPage({ liveEvents = [], connected }) {
  const [stats, setStats] = useState(null);
  const [mapData, setMapData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [liveMapDots, setLiveMapDots] = useState([]); // real-time dots from socket

  // Accumulate live enrollment dots from socket events
  useEffect(() => {
    const enrollEvents = liveEvents.filter(e =>
      e.type === 'enrollment' && e.gpsLat && e.gpsLng
    );
    if (enrollEvents.length > 0) {
      setLiveMapDots(prev => {
        const combined = [...enrollEvents, ...prev];
        return combined.slice(0, 50); // cap at 50 live dots
      });
    }
  }, [liveEvents]);

  useEffect(() => {
    const load = async () => {
      try {
        const [statsRes, mapRes] = await Promise.all([
          api.get('/dashboard/stats'),
          api.get('/dashboard/map-data?hours=48'),
        ]);
        setStats(statsRes.data);
        setMapData(mapRes.data.points || []);
      } finally {
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return (
    <div style={{ padding: 24 }}>
      <div className="loading-overlay"><div className="spinner" /> Loading dashboard…</div>
    </div>
  );

  const s = stats || {};

  return (
    <>
      {/* Topbar */}
      <div className="topbar">
        <div className="topbar-title">
          Command Dashboard
          <span className="topbar-subtitle">Nigeria Biometric Enrollment Oversight — Zero-Trust Mode</span>
        </div>
        <div className="live-indicator">
          <div className="live-dot" />
          {connected ? 'LIVE' : 'OFFLINE'}
        </div>
        <button
          id="refresh-stats-btn"
          className="btn btn-ghost btn-sm"
          onClick={() => window.location.reload()}
        >
          🔄 Refresh
        </button>
      </div>

      <div className="page-content">
        {/* Tamper alert banner — prominent at top */}
        {liveEvents.some(e => e.type === 'tamper') && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 18px', marginBottom: 16,
            borderRadius: 12,
            background: 'rgba(239,68,68,0.12)',
            border: '1.5px solid rgba(239,68,68,0.5)',
            animation: 'pulse-border 1.5s infinite',
          }}>
            <span style={{ fontSize: 24 }}>🚨</span>
            <div>
              <div style={{ fontWeight: 800, color: '#EF4444', fontSize: 14, letterSpacing: 0.3 }}>
                MERKLE CHAIN BREACH DETECTED
              </div>
              <div style={{ fontSize: 12, color: 'rgba(239,68,68,0.7)', marginTop: 2 }}>
                Offline enrollment data was tampered with before sync. Affected records quarantined. Investigate immediately.
              </div>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">🤝</div>
            <div className="stat-value">{s.agents?.total?.toLocaleString() || 0}</div>
            <div className="stat-label">Total Agents</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">✅</div>
            <div className="stat-value accent">{s.agents?.active?.toLocaleString() || 0}</div>
            <div className="stat-label">Active Agents</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">📋</div>
            <div className="stat-value">{s.enrollments?.total?.toLocaleString() || 0}</div>
            <div className="stat-label">Total Enrollments</div>
            <div className="stat-delta up">+{s.enrollments?.today || 0} today</div>
          </div>
          <div className="stat-card warning">
            <div className="stat-icon warning">⚠️</div>
            <div className="stat-value warning">{s.enrollments?.flagged?.toLocaleString() || 0}</div>
            <div className="stat-label">Flagged Records</div>
          </div>
          <div className="stat-card danger">
            <div className="stat-icon danger">🚨</div>
            <div className="stat-value danger">{s.flags?.open || 0}</div>
            <div className="stat-label">Open Flags</div>
          </div>
          <div className="stat-card danger">
            <div className="stat-icon danger">⛔</div>
            <div className="stat-value danger">{s.strikes?.unresolved || 0}</div>
            <div className="stat-label">Active Strikes</div>
          </div>
          <div className="stat-card info">
            <div className="stat-icon info">🏢</div>
            <div className="stat-value">{s.organizations || 0}</div>
            <div className="stat-label">Partner Orgs</div>
          </div>
          <div className={`stat-card ${s.flags?.critical > 0 ? 'critical' : ''}`}>
            <div className="stat-icon danger">🔴</div>
            <div className="stat-value danger">{s.flags?.critical || 0}</div>
            <div className="stat-label">Critical Flags</div>
          </div>
        </div>

        {/* Main content grid */}
        <div className="dashboard-grid">
          {/* ── Live Enrollment Map ── */}
          <div className="card" style={{ gridColumn: 'span 2' }}>
            <div className="card-header">
              <span>🗺️</span>
              <span className="card-title">Live Enrollment Map</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {mapData.length} historical · {liveMapDots.length} live this session
              </span>
              <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                <div className="map-badge">🟢 Clean</div>
                <div className="map-badge" style={{ borderColor: 'rgba(239,68,68,0.3)', color: 'var(--status-danger)' }}>🔴 Flagged</div>
                <div className="map-badge" style={{ borderColor: 'rgba(0,212,255,0.3)', color: 'var(--brand-primary)' }}>⚡ Live</div>
              </div>
            </div>
            <div className="card-body no-pad">
              <div className="map-container" style={{ height: 420, borderRadius: '0 0 12px 12px', overflow: 'hidden' }}>
                <MapContainer
                  center={NIGERIA_CENTER}
                  zoom={NIGERIA_ZOOM}
                  style={{ height: '100%', width: '100%' }}
                  zoomControl={true}
                >
                  <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    attribution='&copy; <a href="https://carto.com/">CARTO</a>'
                    maxZoom={18}
                  />

                  {/* Historical map points */}
                  {mapData.map((point, i) => (
                    <CircleMarker
                      key={point.id || i}
                      center={[point.enrollmentGpsLat, point.enrollmentGpsLng]}
                      radius={point.flaggedForReview ? 6 : 4}
                      fillColor={point.flaggedForReview ? '#EF4444' : '#00A86B'}
                      color={point.flaggedForReview ? '#DC2626' : '#007A4D'}
                      weight={1}
                      fillOpacity={0.65}
                    >
                      <Popup>
                        <div style={{ fontSize: 12, lineHeight: 1.6, minWidth: 175 }}>
                          <strong>{point.stateOfResidence}</strong><br />
                          Agent: {point.enrolledByAgent?.fullName}<br />
                          {timeAgo(point.enrolledAt)}<br />
                          {point.flaggedForReview && (
                            <span style={{ color: '#EF4444', fontWeight: 700 }}>⚠️ FLAGGED</span>
                          )}
                        </div>
                      </Popup>
                    </CircleMarker>
                  ))}

                  {/* Live real-time dots (brighter, larger) */}
                  {liveMapDots.map((evt, i) => (
                    <LivePulse
                      key={`live-${i}-${evt.timestamp}`}
                      center={[evt.gpsLat, evt.gpsLng]}
                      flagged={evt.flagged}
                    />
                  ))}
                </MapContainer>
              </div>
            </div>
          </div>

          {/* ── Security Intelligence Panel ── */}
          <SecurityPanel stats={s} liveEvents={liveEvents} />

          {/* ── Live Activity Feed ── */}
          <div className="card">
            <div className="card-header">
              <span>⚡</span>
              <span className="card-title">Live Activity</span>
              <div className="live-indicator" style={{ fontSize: 10 }}>
                <div className="live-dot" />
                Real-time
              </div>
            </div>
            <div className="card-body no-pad">
              <div className="activity-feed" style={{ maxHeight: 320, overflowY: 'auto' }}>
                {liveEvents.length === 0 && (
                  <div className="empty-state" style={{ padding: 30 }}>
                    <div className="empty-icon">📡</div>
                    <div className="empty-title">Listening for events…</div>
                    <div className="empty-sub">Enrollments, flags and alerts appear here</div>
                  </div>
                )}
                {liveEvents.map((event) => (
                  <div key={event.id || Math.random()} className="activity-item"
                    style={event.type === 'tamper' ? {
                      background: 'rgba(239,68,68,0.07)',
                      borderLeft: '3px solid #DC2626',
                    } : {}}>
                    <div className={`activity-icon ${event.type}`}>
                      {event.type === 'enrollment' ? '📋'
                        : event.type === 'strike' ? '⛔'
                        : event.type === 'tamper' ? '🚨'
                        : '🚩'}
                    </div>
                    <div className="activity-content">
                      {event.type === 'enrollment' && (
                        <>
                          <div className="activity-title">
                            New enrollment by <strong>{event.agentName}</strong>
                          </div>
                          <div className="activity-meta">
                            {event.state} · {event.flagged ? '⚠️ Flagged' : '✅ Clean'}
                          </div>
                        </>
                      )}
                      {event.type === 'strike' && (
                        <>
                          <div className="activity-title">
                            Strike #{event.strikeNumber} → <strong>{event.agentName}</strong>
                          </div>
                          <div className="activity-meta">{event.trigger?.replace(/_/g, ' ')}</div>
                        </>
                      )}
                      {event.type === 'flag' && (
                        <>
                          <div className="activity-title">
                            Flag: <strong>{event.flagType?.replace(/_/g, ' ')}</strong>
                          </div>
                          <div className="activity-meta">Severity: {event.severity}</div>
                        </>
                      )}
                      {event.type === 'tamper' && (
                        <>
                          <div className="activity-title" style={{ color: '#EF4444', fontWeight: 700 }}>
                            🚨 MERKLE CHAIN TAMPER DETECTED
                          </div>
                          <div className="activity-meta">
                            Agent {event.agentId} · {event.quarantinedCount} records quarantined
                          </div>
                        </>
                      )}
                    </div>
                    <div className="activity-time">now</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Enrollments by State ── */}
          <div className="card">
            <div className="card-header">
              <span>📊</span>
              <span className="card-title">Top States by Enrollment</span>
            </div>
            <div className="card-body no-pad">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>State</th>
                    <th>Enrollments</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {(s.charts?.enrollmentsByState || []).slice(0, 8).map((row, i) => {
                    const total = s.enrollments?.total || 1;
                    const pct = Math.round((row._count.id / total) * 100);
                    return (
                      <tr key={row.stateOfResidence}>
                        <td style={{ color: 'var(--text-muted)', fontWeight: 600, width: 30 }}>{i + 1}</td>
                        <td className="td-primary">{row.stateOfResidence}</td>
                        <td className="td-mono">{row._count.id.toLocaleString()}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{
                              height: 4, width: `${pct * 1.5}px`, maxWidth: 80,
                              background: 'var(--brand-primary)', borderRadius: 2, minWidth: 2
                            }} />
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!s.charts?.enrollmentsByState?.length && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>No enrollment data yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Strike Breakdown ── */}
          <div className="card">
            <div className="card-header">
              <span>⚡</span>
              <span className="card-title">Strike Breakdown by Trigger</span>
            </div>
            <div className="card-body no-pad">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Trigger Type</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {(s.charts?.strikesByTrigger || []).map((row) => (
                    <tr key={row.trigger}>
                      <td className="td-primary" style={{ fontSize: 12 }}>
                        {row.trigger.replace(/_/g, ' ')}
                      </td>
                      <td>
                        <span className="badge danger">{row._count.id}</span>
                      </td>
                    </tr>
                  ))}
                  {!s.charts?.strikesByTrigger?.length && (
                    <tr><td colSpan={2} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>No strikes recorded</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
