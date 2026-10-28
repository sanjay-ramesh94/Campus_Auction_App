import React, { useState, useRef } from 'react';

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
  const [images, setImages] = useState<string[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFiles = async (fileList: FileList | File[]) => {
    const filesArray = Array.from(fileList);
    if (filesArray.length === 0) return;

    if (images.length + filesArray.length > 5) {
      showToast('warning', 'Limit Reached', 'You can upload a maximum of 5 images per listing');
    }

    const availableSlots = 5 - images.length;
    if (availableSlots <= 0) return;

    const filesToUpload = filesArray.slice(0, availableSlots);
    setUploadingImage(true);

    for (const file of filesToUpload) {
      if (!file.type.startsWith('image/')) {
        showToast('warning', 'Invalid File', `${file.name} is not an image file`);
        continue;
      }

      if (file.size > 8 * 1024 * 1024) {
        showToast('warning', 'File Too Large', `${file.name} exceeds 8MB size limit`);
        continue;
      }

      try {
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        let finalUrl = base64Data;
        try {
          const res = await fetch('/api/upload', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              data: base64Data,
              filename: file.name,
            }),
          });
          const data = await res.json();
          if (res.ok && data.ok && data.url) {
            finalUrl = data.url;
          }
        } catch {}

        setImages((prev) => [...prev, finalUrl]);
      } catch {
        showToast('error', 'Upload Error', `Failed to read ${file.name}`);
      }
    }

    setUploadingImage(false);
  };

  const handleRemoveImage = (indexToRemove: number) => {
    setImages((prev) => prev.filter((_, i) => i !== indexToRemove));
  };

  const handleSetPrimary = (indexToPrimary: number) => {
    setImages((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(indexToPrimary, 1);
      return [item, ...copy];
    });
  };

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
      const listingImages = images.length > 0
        ? images
        : ['https://images.unsplash.com/photo-1526738549149-8e07eca6c147?auto=format&fit=crop&w=600&q=80'];

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
          images: listingImages,
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

          {/* Local Image Upload (Drag-and-Drop + File Picker) */}
          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <label style={{ margin: 0 }}>Item Photos ({images.length}/5)</label>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                PNG, JPG, WEBP (Max 8MB each)
              </span>
            </div>

            <input
              type="file"
              ref={fileInputRef}
              accept="image/png, image/jpeg, image/jpg, image/webp"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files) {
                  handleFiles(e.target.files);
                  e.target.value = '';
                }
              }}
            />

            {images.length === 0 ? (
              <div
                className={`image-upload-box ${isDragging ? 'drag-over' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files) {
                    handleFiles(e.dataTransfer.files);
                  }
                }}
              >
                <div className="upload-icon">{uploadingImage ? '⏳' : '📷'}</div>
                <div className="upload-text-main">
                  {uploadingImage ? 'Processing local photo...' : 'Click to browse local images or drag & drop'}
                </div>
                <div className="upload-text-sub">
                  Select clear photos from your device to display on the auction listing
                </div>
              </div>
            ) : (
              <div>
                <div className="image-preview-grid">
                  {images.map((imgUrl, idx) => (
                    <div key={idx} className="image-preview-card">
                      <img src={imgUrl} alt={`Uploaded ${idx + 1}`} />
                      {idx === 0 && (
                        <div className="image-primary-badge">★ Cover</div>
                      )}
                      <button
                        type="button"
                        className="image-remove-btn"
                        onClick={() => handleRemoveImage(idx)}
                        title="Remove photo"
                      >
                        ✕
                      </button>
                      {idx > 0 && (
                        <button
                          type="button"
                          style={{
                            position: 'absolute',
                            bottom: '5px',
                            left: '5px',
                            background: 'rgba(15, 23, 42, 0.75)',
                            color: '#cbd5e1',
                            border: 'none',
                            fontSize: '0.65rem',
                            padding: '0.1rem 0.35rem',
                            borderRadius: '4px',
                            cursor: 'pointer',
                          }}
                          onClick={() => handleSetPrimary(idx)}
                          title="Make this cover photo"
                        >
                          Set Cover
                        </button>
                      )}
                    </div>
                  ))}

                  {images.length < 5 && (
                    <div
                      className="image-upload-add-more"
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDragging(true);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                        if (e.dataTransfer.files) {
                          handleFiles(e.dataTransfer.files);
                        }
                      }}
                      title="Add more photos"
                    >
                      <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>+</span>
                      <span>Add Photo</span>
                    </div>
                  )}
                </div>
                <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#64748b' }}>
                  <span>✓ {images.length} photo(s) selected from your device</span>
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.75rem' }}
                    onClick={() => setImages([])}
                  >
                    Clear all
                  </button>
                </div>
              </div>
            )}
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
