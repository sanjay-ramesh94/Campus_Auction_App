import React, { useState, useEffect } from 'react';
import type { WatchRequest } from '../types';

interface WatchlistTabProps {
  token: string;
  showToast: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
}

export const WatchlistTab: React.FC<WatchlistTabProps> = ({ token, showToast }) => {
  const [requests, setRequests] = useState<WatchRequest[]>([]);
  const [keywords, setKeywords] = useState('');
  const [category, setCategory] = useState('All');
  const [maxPrice, setMaxPrice] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchWatchRequests = async () => {
    try {
      const res = await fetch('/api/watch-requests', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) setRequests(data.requests || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchWatchRequests();
  }, [token]);

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keywords.trim()) return;
    setLoading(true);

    try {
      const kwList = keywords
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);

      const res = await fetch('/api/watch-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          keywords: kwList,
          category: category !== 'All' ? category : undefined,
          maxPrice: maxPrice ? parseInt(maxPrice, 10) : undefined,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        showToast('success', 'Alert Created!', 'You will be notified whenever a matching item is listed.');
        setKeywords('');
        setMaxPrice('');
        fetchWatchRequests();
      } else {
        showToast('error', 'Error', data.error);
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/watch-requests/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        showToast('info', 'Alert Removed', 'Watch request has been deleted.');
        setRequests((prev) => prev.filter((r) => r._id !== id));
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    }
  };

  return (
    <div className="watchlist-layout">
      <div className="tab-header-box">
        <h2>"Looking for..." Campus Alerts</h2>
        <p>Save item requests (e.g. "scientific calculator, up to ₹400"). The engine will automatically ping you when a graduating senior lists a match!</p>
      </div>

      {/* Form */}
      <form onSubmit={handleCreateRequest} className="watchlist-form">
        <div className="form-cols-3">
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label>Keywords (comma separated) *</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. scientific calculator, graphing, casio"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label>Max Budget Cap (₹)</label>
            <input
              type="number"
              className="form-input"
              placeholder="e.g. 500"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', marginTop: '0.5rem' }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Category (Optional)</label>
            <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="All">Any Category</option>
              <option value="Electronics">Electronics</option>
              <option value="Bicycles">Bicycles</option>
              <option value="Books">Books</option>
              <option value="Dorm">Dorm</option>
              <option value="Music">Music</option>
            </select>
          </div>

          <button className="btn btn-primary" type="submit" disabled={loading || !keywords.trim()}>
            {loading ? 'Saving...' : '+ Set Alert'}
          </button>
        </div>
      </form>

      {/* Existing Requests */}
      <div className="watchlist-items" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ fontSize: '1rem', color: '#94a3b8', marginBottom: '0.75rem' }}>
          Active Alerts ({requests.length})
        </h3>

        {requests.length === 0 ? (
          <div className="empty-catalog-card">
            <p>No active watch alerts set yet.</p>
          </div>
        ) : (
          <div className="watchlist-grid">
            {requests.map((r) => (
              <div key={r._id} className="watch-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div className="watch-keywords">
                    {r.keywords.map((kw, i) => (
                      <span key={i} className="keyword-chip">{kw}</span>
                    ))}
                  </div>
                  <button className="btn-icon" onClick={() => handleDelete(r._id)} title="Delete Alert">
                    ✕
                  </button>
                </div>

                <div className="watch-details" style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#64748b' }}>
                  {r.category && <span>Category: {r.category} · </span>}
                  {r.maxPrice && <span>Max: ₹{r.maxPrice.toLocaleString()} · </span>}
                  <span>Created: {new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
