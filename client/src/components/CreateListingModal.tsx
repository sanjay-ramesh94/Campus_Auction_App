import React, { useState } from 'react';

interface CreateListingModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  onCreated: () => void;
  showToast: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
}

export const CreateListingModal: React.FC<CreateListingModalProps> = ({
  isOpen,
  onClose,
  token,
  onCreated,
  showToast,
}) => {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Electronics');
  const [condition, setCondition] = useState('Like New');
  const [startPrice, setStartPrice] = useState<number>(500);
  const [minIncrement, setMinIncrement] = useState<number>(50);
  const [maxPrice, setMaxPrice] = useState<number>(2500);
  const [durationMinutes, setDurationMinutes] = useState<number>(15);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    // Inline validations as required
    if (!title.trim()) {
      setValidationError('Title is required');
      return;
    }
    if (startPrice <= 0) {
      setValidationError('Starting price must be greater than ₹0');
      return;
    }
    if (startPrice > maxPrice) {
      setValidationError('Starting price cannot be greater than maximum buyout price (start ≤ max)');
      return;
    }
    if (minIncrement <= 0) {
      setValidationError('Minimum increment must be greater than ₹0');
      return;
    }
    if (durationMinutes <= 0) {
      setValidationError('Closing time must be in the future (duration > 0)');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/seller/auctions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          category,
          condition,
          startPrice,
          minIncrement,
          maxPrice,
          durationMinutes,
          description,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        showToast('success', 'Listing Created!', `"${title}" is now active in the catalog.`);
        onCreated();
        onClose();
      } else {
        setValidationError(data.error || 'Failed to create listing');
      }
    } catch (err: any) {
      setValidationError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-top">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem' }}>Create Campus Listing</h2>
          <button className="btn-close" type="button" onClick={onClose}>&times;</button>
        </div>

        {validationError && (
          <div className="auth-error-banner" style={{ margin: '0' }}>
            <span>⚠️</span> {validationError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="form-grid">
          <div className="form-group">
            <label>Item Title *</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. TI-84 Plus Graphing Calculator"
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
                min="1"
                value={startPrice}
                onChange={(e) => setStartPrice(parseInt(e.target.value, 10))}
                required
              />
            </div>

            <div className="form-group">
              <label>Increment (₹) *</label>
              <input
                type="number"
                className="form-input"
                min="1"
                value={minIncrement}
                onChange={(e) => setMinIncrement(parseInt(e.target.value, 10))}
                required
              />
            </div>

            <div className="form-group">
              <label>Max Buyout (₹) *</label>
              <input
                type="number"
                className="form-input"
                min="1"
                value={maxPrice}
                onChange={(e) => setMaxPrice(parseInt(e.target.value, 10))}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>Closing In (Minutes) *</label>
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
              💡 Set to 1-2 minutes to test anti-sniping (+60s auto extensions) and closing approval!
            </span>
          </div>

          <div className="form-group">
            <label>Description & Notes</label>
            <textarea
              className="form-textarea"
              rows={2}
              placeholder="Meeting spot on campus, accessories included, condition notes..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button className="btn btn-secondary" type="button" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Publishing...' : 'Publish Listing'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
