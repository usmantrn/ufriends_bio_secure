import { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import api from '../api/client';

// Leaflet CSS hack for Vite
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

export default function DashboardPage({ liveEvents = [], connected }) {
  const [stats, setStats] = useState(null);
  const [mapData, setMapData] = useState([]);
  const [loading, setLoading] = useState(true);

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
    const interval = setInterval(load, 30000); // refresh stats every 30s
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
          <span className="topbar-subtitle">Nigeria Biometric Enrollment Oversight</span>
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
          {/* Map */}
          <div className="card">
            <div className="card-header">
              <span>🗺️</span>
              <span className="card-title">Live Enrollment Map</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{mapData.length} points · last 48h</span>
              <div className="map-overlay" style={{ position: 'relative', inset: 'auto' }}>
                <div className="map-badge">🟢 Clean</div>
                <div className="map-badge" style={{ borderColor: 'rgba(239,68,68,0.3)', color: 'var(--status-danger)' }}>🔴 Flagged</div>
              </div>
            </div>
            <div className="card-body no-pad">
              <div className="map-container" style={{ height: 380 }}>
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
                  {mapData.map((point, i) => (
                    <CircleMarker
                      key={point.id || i}
                      center={[point.enrollmentGpsLat, point.enrollmentGpsLng]}
                      radius={point.flaggedForReview ? 7 : 5}
                      fillColor={point.flaggedForReview ? '#EF4444' : '#00A86B'}
                      color={point.flaggedForReview ? '#DC2626' : '#007A4D'}
                      weight={1}
                      fillOpacity={0.75}
                    >
                      <Popup>
                        <div style={{ fontSize: 12, lineHeight: 1.6, minWidth: 160 }}>
                          <strong>{point.stateOfResidence}</strong><br />
                          Agent: {point.enrolledByAgent?.fullName}<br />
                          {timeAgo(point.enrolledAt)}<br />
                          {point.flaggedForReview && <span style={{ color: 'red', fontWeight: 600 }}>⚠️ FLAGGED</span>}
                        </div>
                      </Popup>
                    </CircleMarker>
                  ))}
                </MapContainer>
              </div>
            </div>
          </div>

          {/* Live Activity Feed */}
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
              <div className="activity-feed" style={{ maxHeight: 340, overflowY: 'auto' }}>
                {liveEvents.length === 0 && (
                  <div className="empty-state" style={{ padding: 30 }}>
                    <div className="empty-icon">📡</div>
                    <div className="empty-title">Listening for events…</div>
                    <div className="empty-sub">New enrollments and alerts will appear here in real-time</div>
                  </div>
                )}
                {liveEvents.map((event) => (
                  <div key={event.id} className="activity-item">
                    <div className={`activity-icon ${event.type}`}>
                      {event.type === 'enrollment' ? '📋' : event.type === 'strike' ? '⛔' : '🚩'}
                    </div>
                    <div className="activity-content">
                      {event.type === 'enrollment' && (
                        <>
                          <div className="activity-title">
                            New enrollment by <strong>{event.agentName}</strong>
                          </div>
                          <div className="activity-meta">
                            {event.state} · {event.flagged ? '⚠️ Flagged' : 'Clean'}
                          </div>
                        </>
                      )}
                      {event.type === 'strike' && (
                        <>
                          <div className="activity-title">
                            Strike #{event.strikeNumber} issued to <strong>{event.agentName}</strong>
                          </div>
                          <div className="activity-meta">{event.trigger?.replace(/_/g, ' ')}</div>
                        </>
                      )}
                      {event.type === 'flag' && (
                        <>
                          <div className="activity-title">
                            Flag raised: <strong>{event.flagType?.replace(/_/g, ' ')}</strong>
                          </div>
                          <div className="activity-meta">Severity: {event.severity}</div>
                        </>
                      )}
                    </div>
                    <div className="activity-time">now</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Enrollments by State */}
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
                </tbody>
              </table>
            </div>
          </div>

          {/* Strike Breakdown */}
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
