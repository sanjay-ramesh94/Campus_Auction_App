import React, { useState } from 'react';
import type { UserPersona } from '../types';

interface CreateAuctionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPersona: UserPersona;
  onCreated: () => void;
  showToast: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
}

export const CreateAuctionModal: React.FC<CreateAuctionModalProps> = ({
  isOpen,
  onClose,
  currentPersona,
  onCreated,
  showToast,
}) => {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Electronics');
  const [condition, setCondition] = useState('Like New');
  const [startPrice, setStartPrice] = useState(500);
  const [minIncrement, setMinIncrement] = useState(50);
  const [maxPrice, setMaxPrice] = useState(2500);
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !startPrice) return;
    setLoading(true);

    try {
      const res = await fetch('/api/auctions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          category,
          condition,
          startPrice,
          minIncrement,
          maxPrice,
          durationMinutes,
          description,
          sellerId: currentPersona.id,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        showToast('success', 'Auction Created!', `"${title}" is now live for bidding!`);
        onCreated();
        onClose();
      } else {
        showToast('error', 'Creation Failed', data.error || 'Failed to list item');
      }
    } catch (err: unknown) {
      showToast('error', 'Error', String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-top">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem' }}>List Campus Item</h2>
          <button className="btn-close" type="button" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="form-grid">
          <div className="form-group">
            <label>Item Title *</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. iPad 9th Gen 64GB + Apple Pencil"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="form-row-2">
            <div className="form-group">
              <label>Category</label>
              <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="Electronics">Electronics</option>
                <option value="Bicycles">Bicycles / Commute</option>
                <option value="Books">Textbooks & Notes</option>
                <option value="Dorm">Dorm Furniture</option>
                <option value="Music">Musical Instruments</option>
              </select>
            </div>

            <div className="form-group">
              <label>Condition</label>
              <select className="form-select" value={condition} onChange={(e) => setCondition(e.target.value)}>
                <option value="Like New">Like New</option>
                <option value="Good">Good</option>
                <option value="Fair">Fair</option>
              </select>
            </div>
          </div>

          <div className="form-row-3">
            <div className="form-group">
              <label>Start (₹) *</label>
              <input
                type="number"
                className="form-input"
                min="10"
                step="10"
                value={startPrice}
                onChange={(e) => setStartPrice(parseInt(e.target.value, 10))}
                required
              />
            </div>

            <div className="form-group">
              <label>Increment (₹)</label>
              <input
                type="number"
                className="form-input"
                min="10"
                step="10"
                value={minIncrement}
                onChange={(e) => setMinIncrement(parseInt(e.target.value, 10))}
                required
              />
            </div>

            <div className="form-group">
              <label>Max Buyout (₹)</label>
              <input
                type="number"
                className="form-input"
                min="50"
                step="50"
                value={maxPrice}
                onChange={(e) => setMaxPrice(parseInt(e.target.value, 10))}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>Duration (Minutes)</label>
            <input
              type="number"
              className="form-input"
              min="1"
              max="1440"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(parseInt(e.target.value, 10))}
              required
            />
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
              💡 Set to 1-2 minutes to test real-time anti-sniping (+60s extensions)!
            </span>
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea
              className="form-textarea"
              rows={2}
              placeholder="Pick up location on campus, included accessories, etc."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button className="btn btn-secondary" type="button" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'List Auction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
