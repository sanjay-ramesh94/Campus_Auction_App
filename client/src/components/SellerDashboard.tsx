import React, { useState, useEffect, useRef } from 'react';
import type { Auction, User, BuyerContactDetails } from '../types';

interface SellerDashboardProps {
  user: User;
  token: string | null;
  onSelectAuction: (id: string) => void;
  onShowToast: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
}

export const SellerDashboard: React.FC<SellerDashboardProps> = ({
  user,
  token,
  onSelectAuction,
  onShowToast,
}) => {
  // Navigation tabs: 'posted' | 'sold' | 'unsold' | 'sell'
  const [panelTab, setPanelTab] = useState<'posted' | 'sold' | 'unsold' | 'sell'>('posted');

  // Auctions data by status
  const [postedAuctions, setPostedAuctions] = useState<Auction[]>([]);
  const [soldAuctions, setSoldAuctions] = useState<Auction[]>([]);
  const [unsoldAuctions, setUnsoldAuctions] = useState<Auction[]>([]);

  // Buyer details modal state
  const [viewingBuyerAuction, setViewingBuyerAuction] = useState<Auction | null>(null);
  const [buyerContact, setBuyerContact] = useState<BuyerContactDetails | null>(null);
  const [loadingBuyer, setLoadingBuyer] = useState(false);

  // Relist modal state
  const [relistingAuction, setRelistingAuction] = useState<Auction | null>(null);
  const [relistStartPrice, setRelistStartPrice] = useState<number>(500);
  const [relistDuration, setRelistDuration] = useState<number>(15);
  const [relisting, setRelisting] = useState(false);

  // Create Listing Form state
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Electronics');
  const [description, setDescription] = useState('');
  const [condition, setCondition] = useState('Good Condition');
  const [startPrice, setStartPrice] = useState<number>(500);
  const [minIncrement, setMinIncrement] = useState<number>(50);
  const [duration, setDuration] = useState('1 Minute (Testing)');
  const [images, setImages] = useState<string[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);

  // Fetch all 3 status lists from /api/seller/auctions?status=...
  const fetchSellerAuctions = async () => {
    if (!token) return;
    try {
      const [liveRes, soldRes, unsoldRes] = await Promise.all([
        fetch('/api/seller/auctions?status=live', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/seller/auctions?status=sold', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/seller/auctions?status=unsold', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const [liveData, soldData, unsoldData] = await Promise.all([
        liveRes.json(),
        soldRes.json(),
        unsoldRes.json(),
      ]);

      if (liveData.ok) setPostedAuctions(liveData.auctions || []);
      if (soldData.ok) setSoldAuctions(soldData.auctions || []);
      if (unsoldData.ok) setUnsoldAuctions(unsoldData.auctions || []);
    } catch (err) {
      console.error('Error fetching seller auctions:', err);
    }
  };

  useEffect(() => {
    fetchSellerAuctions();
    const interval = setInterval(fetchSellerAuctions, 4000);
    return () => clearInterval(interval);
  }, [token]);

  // View Buyer Details handler
  const handleViewBuyer = async (auction: Auction) => {
    setViewingBuyerAuction(auction);
    setBuyerContact(null);
    setLoadingBuyer(true);
    try {
      const res = await fetch(`/api/seller/auctions/${auction._id}/buyer`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok && data.buyer) {
        setBuyerContact(data.buyer);
      } else {
        onShowToast('error', 'Buyer Details', data.error || 'Failed to retrieve buyer contact');
        setViewingBuyerAuction(null);
      }
    } catch {
      onShowToast('error', 'Error', 'Failed to retrieve buyer details');
      setViewingBuyerAuction(null);
    } finally {
      setLoadingBuyer(false);
    }
  };

  // Open Relist Modal
  const handleOpenRelist = (auction: Auction) => {
    setRelistingAuction(auction);
    setRelistStartPrice(auction.startPrice || 500);
    setRelistDuration(15);
  };

  // Submit Relist
  const handleRelistSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!relistingAuction) return;
    setRelisting(true);
    try {
      const res = await fetch(`/api/seller/auctions/${relistingAuction._id}/relist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          startPrice: relistStartPrice,
          durationMinutes: relistDuration,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        onShowToast('success', 'Auction Relisted!', `"${relistingAuction.title}" is now Live.`);
        setRelistingAuction(null);
        setPanelTab('posted');
        fetchSellerAuctions();
      } else {
        onShowToast('error', 'Relist Failed', data.error || 'Could not relist auction');
      }
    } catch {
      onShowToast('error', 'Error', 'Failed to relist auction');
    } finally {
      setRelisting(false);
    }
  };

  // Local file upload processor
  const handleFiles = async (fileList: FileList | File[]) => {
    const filesArray = Array.from(fileList);
    if (filesArray.length === 0) return;

    if (images.length + filesArray.length > 5) {
      onShowToast('warning', 'Limit Reached', 'You can upload a maximum of 5 images per listing');
    }

    const availableSlots = 5 - images.length;
    if (availableSlots <= 0) return;

    const filesToUpload = filesArray.slice(0, availableSlots);
    setUploadingImage(true);

    for (const file of filesToUpload) {
      if (!file.type.startsWith('image/')) {
        onShowToast('warning', 'Invalid File', `${file.name} is not an image file`);
        continue;
      }

      if (file.size > 8 * 1024 * 1024) {
        onShowToast('warning', 'File Too Large', `${file.name} exceeds 8MB size limit`);
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
            body: JSON.stringify({ image: base64Data, filename: file.name }),
          });
          const data = await res.json();
          if (data.ok && data.url) {
            finalUrl = data.url;
          }
        } catch {
          // fallback to base64Data
        }

        setImages((prev) => [...prev, finalUrl]);
      } catch {
        onShowToast('error', 'Upload Failed', `Could not process ${file.name}`);
      }
    }

    setUploadingImage(false);
  };

  const handleCreateListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      onShowToast('warning', 'Missing Field', 'Please provide an item title');
      return;
    }

    let durationMinutes = 15;
    if (duration === '1 Minute (Testing)') durationMinutes = 1;
    else if (duration === '15 Minutes') durationMinutes = 15;
    else if (duration === '1 Hour') durationMinutes = 60;
    else if (duration === '24 Hours') durationMinutes = 24 * 60;
    else if (duration === '3 Days') durationMinutes = 3 * 24 * 60;

    setCreating(true);
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
          description: description.trim(),
          condition,
          startPrice,
          minIncrement,
          durationMinutes,
          images: images.length > 0 ? images : undefined,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        onShowToast('success', 'Listing Created!', `"${title}" is now Live for bidding.`);
        setTitle('');
        setDescription('');
        setImages([]);
        setStartPrice(500);
        setPanelTab('posted');
        fetchSellerAuctions();
      } else {
        onShowToast('error', 'Creation Failed', data.error || 'Could not create auction');
      }
    } catch {
      onShowToast('error', 'Error', 'Failed to connect to server');
    } finally {
      setCreating(false);
    }
  };

  const formatCountdown = (closesAtStr: string) => {
    const diff = new Date(closesAtStr).getTime() - Date.now();
    if (diff <= 0) return 'Closed';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff / 1000 / 60) % 60);
    const seconds = Math.floor((diff / 1000) % 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m ${seconds}s`;
  };

  return (
    <div className="app-body-container">
      <div className="seller-layout">
        {/* Left Sidebar */}
        <aside className="seller-sidebar">
          <button
            className={`seller-menu-btn ${panelTab === 'posted' ? 'active' : ''}`}
            onClick={() => setPanelTab('posted')}
          >
            <span>🏷️</span>
            <span>Posted ({postedAuctions.length})</span>
          </button>
          <button
            className={`seller-menu-btn ${panelTab === 'sold' ? 'active' : ''}`}
            onClick={() => setPanelTab('sold')}
          >
            <span>🏆</span>
            <span>Closed (Sold) ({soldAuctions.length})</span>
          </button>
          <button
            className={`seller-menu-btn ${panelTab === 'unsold' ? 'active' : ''}`}
            onClick={() => setPanelTab('unsold')}
          >
            <span>⏱️</span>
            <span>Not Attended ({unsoldAuctions.length})</span>
          </button>
          <button
            className={`seller-menu-btn ${panelTab === 'sell' ? 'active' : ''}`}
            onClick={() => setPanelTab('sell')}
          >
            <span>➕</span>
            <span>Create Listing</span>
          </button>
        </aside>

        {/* Main Content Area */}
        <main>
          {panelTab === 'sell' ? (
            /* Create a New Listing Form */
            <div className="seller-content-card" style={{ padding: '2rem' }}>
              <div style={{ marginBottom: '1.75rem' }}>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 700 }}>
                  Create a New Listing
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                  Fill in the details to list your item for live campus bidding (Seller: {user.name}).
                </p>
              </div>

              <form onSubmit={handleCreateListing}>
                {/* Title & Category */}
                <div className="form-grid-2" style={{ marginBottom: '1.25rem' }}>
                  <div>
                    <label className="form-label">Item Title</label>
                    <input
                      type="text"
                      className="input-field"
                      style={{ paddingLeft: '1rem' }}
                      placeholder="e.g. Mechanical Keyboard"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Category</label>
                    <select
                      className="select-field"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <option value="Electronics">Electronics</option>
                      <option value="Bicycles">Bicycles</option>
                      <option value="Furniture">Furniture</option>
                      <option value="Books">Books</option>
                      <option value="Hostel Essentials">Hostel Essentials</option>
                      <option value="Others">Others</option>
                    </select>
                  </div>
                </div>

                {/* Description */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <label className="form-label">Description & Accessories</label>
                  <textarea
                    className="textarea-field"
                    placeholder="Describe condition, specs, hostel block for pickup..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                  />
                </div>

                {/* Condition & Prices */}
                <div className="form-grid-3" style={{ marginBottom: '1.25rem' }}>
                  <div>
                    <label className="form-label">Condition</label>
                    <select
                      className="select-field"
                      value={condition}
                      onChange={(e) => setCondition(e.target.value)}
                    >
                      <option value="Brand New">Brand New</option>
                      <option value="Like New">Like New</option>
                      <option value="Good Condition">Good Condition</option>
                      <option value="Fair / Used">Fair / Used</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Starting Price (₹)</label>
                    <input
                      type="number"
                      className="input-field"
                      style={{ paddingLeft: '1rem' }}
                      min="1"
                      value={startPrice}
                      onChange={(e) => setStartPrice(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Min Increment (₹)</label>
                    <input
                      type="number"
                      className="input-field"
                      style={{ paddingLeft: '1rem' }}
                      min="10"
                      step="10"
                      value={minIncrement}
                      onChange={(e) => setMinIncrement(Math.max(10, parseInt(e.target.value, 10) || 10))}
                      required
                    />
                  </div>
                </div>

                {/* Duration */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <label className="form-label">Auction Duration</label>
                  <select
                    className="select-field"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                  >
                    <option value="1 Minute (Testing)">1 Minute (Fast Testing)</option>
                    <option value="15 Minutes">15 Minutes</option>
                    <option value="1 Hour">1 Hour</option>
                    <option value="24 Hours">24 Hours (Standard)</option>
                    <option value="3 Days">3 Days</option>
                  </select>
                </div>

                {/* Local Image Upload Area */}
                <div style={{ marginBottom: '1.75rem' }}>
                  <label className="form-label">Item Photos (Max 5)</label>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      border: `2px dashed ${isDragging ? '#2563eb' : '#cbd5e1'}`,
                      background: isDragging ? '#eff6ff' : '#f8fafc',
                      borderRadius: '8px',
                      padding: '1.75rem',
                      textAlign: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      style={{ display: 'none' }}
                      accept="image/*"
                      multiple
                      onChange={(e) => e.target.files && handleFiles(e.target.files)}
                    />
                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📷</div>
                    <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>
                      Click to upload photos or drag and drop
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      PNG, JPG up to 8MB each ({images.length}/5 photos uploaded)
                    </div>
                  </div>

                  {images.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                      {images.map((img, idx) => (
                        <div key={idx} style={{ position: 'relative' }}>
                          <img
                            src={img}
                            alt={`Preview ${idx + 1}`}
                            style={{ width: '70px', height: '70px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #e2e8f0' }}
                          />
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setImages(images.filter((_, i) => i !== idx)); }}
                            style={{
                              position: 'absolute',
                              top: '-6px',
                              right: '-6px',
                              background: '#ef4444',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '50%',
                              width: '20px',
                              height: '20px',
                              fontSize: '12px',
                              cursor: 'pointer',
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn-outline-action"
                    onClick={() => setPanelTab('posted')}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={creating || uploadingImage}
                    style={{ minWidth: '160px' }}
                  >
                    {creating ? 'Publishing...' : 'Publish Auction'}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            /* Seller Panel: Posted | Closed (Sold) | Not Attended (Unsold) */
            <div className="seller-content-card" style={{ padding: '1.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <div>
                  <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 700 }}>
                    Seller Panel
                  </h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                    Track your live auctions, view winning buyer details, and relist unsold inventory.
                  </p>
                </div>
                <button
                  className="btn-primary"
                  onClick={() => setPanelTab('sell')}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem' }}
                >
                  <span>➕</span>
                  <span>New Listing</span>
                </button>
              </div>

              {/* 3 Subtabs bar: Posted, Closed (Sold), Not Attended (Unsold) */}
              <div className="bids-filter-bar" style={{ marginBottom: '1.5rem' }}>
                <button
                  className={`bid-filter-chip ${panelTab === 'posted' ? 'active' : ''}`}
                  onClick={() => setPanelTab('posted')}
                >
                  Posted ({postedAuctions.length})
                </button>
                <button
                  className={`bid-filter-chip ${panelTab === 'sold' ? 'active' : ''}`}
                  onClick={() => setPanelTab('sold')}
                >
                  Closed (Sold) ({soldAuctions.length})
                </button>
                <button
                  className={`bid-filter-chip ${panelTab === 'unsold' ? 'active' : ''}`}
                  onClick={() => setPanelTab('unsold')}
                >
                  Not Attended (Unsold) ({unsoldAuctions.length})
                </button>
              </div>

              {/* Tab 1: Posted (Live) */}
              {panelTab === 'posted' && (
                <div className="bids-list">
                  {postedAuctions.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-muted)' }}>
                      <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🏷️</div>
                      <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                        No Live Auctions Posted
                      </h3>
                      <p style={{ fontSize: '0.88rem', maxWidth: '380px', margin: '0 auto 1.25rem' }}>
                        You don't have any active live auctions right now. Create a new listing to start selling!
                      </p>
                      <button className="btn-primary" onClick={() => setPanelTab('sell')}>
                        + Create a Listing
                      </button>
                    </div>
                  ) : (
                    postedAuctions.map((item) => {
                      const img = item.images && item.images.length > 0 && item.images[0]
                        ? item.images[0]
                        : 'https://images.unsplash.com/photo-1526738549149-8e07eca6c147?auto=format&fit=crop&w=400&q=80';
                      const cur = item.currentPrice || item.startPrice;

                      return (
                        <div
                          key={item._id}
                          className="bid-row-card"
                          onClick={() => onSelectAuction(item._id)}
                          style={{ cursor: 'pointer' }}
                        >
                          <div className="bid-row-left">
                            <img src={img} alt={item.title} className="bid-row-thumb" />
                            <div className="bid-row-info">
                              <div className="bid-row-title">{item.title}</div>
                              <div className="bid-row-pricing">
                                <span className="bid-row-cur-bid">Current Bid: ₹{cur.toLocaleString()}</span>
                                <span>·</span>
                                <span style={{ color: '#0284c7', fontWeight: 600, fontSize: '0.85rem' }}>
                                  {item.bidCount} Bids placed
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="bid-row-right">
                            <div className="bid-row-timer">
                              <span>⏱</span>
                              <span>{formatCountdown(item.closesAt)}</span>
                            </div>
                            <button
                              className="btn-outline-action"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectAuction(item._id);
                              }}
                            >
                              Live Console
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* Tab 2: Closed (Sold) with "View buyer details" button */}
              {panelTab === 'sold' && (
                <div className="bids-list">
                  {soldAuctions.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-muted)' }}>
                      <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🏆</div>
                      <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                        No Sold Items Yet
                      </h3>
                      <p style={{ fontSize: '0.88rem', maxWidth: '380px', margin: '0 auto' }}>
                        When an auction concludes with bids, it will be listed here with buyer contact details.
                      </p>
                    </div>
                  ) : (
                    soldAuctions.map((item) => {
                      const img = item.images && item.images.length > 0 && item.images[0]
                        ? item.images[0]
                        : 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=400&q=80';
                      const finalPrice = item.currentPrice || item.startPrice;
                      const closedDate = new Date(item.closesAt || item.createdAt || Date.now()).toLocaleDateString();

                      return (
                        <div
                          key={item._id}
                          className="bid-row-card"
                          onClick={() => onSelectAuction(item._id)}
                          style={{ cursor: 'pointer' }}
                        >
                          <div className="bid-row-left">
                            <img src={img} alt={item.title} className="bid-row-thumb" />
                            <div className="bid-row-info">
                              <div className="bid-row-title">{item.title}</div>
                              <div className="bid-row-pricing">
                                <span className="bid-row-cur-bid">Final Price: ₹{finalPrice.toLocaleString()}</span>
                                <span>·</span>
                                <span style={{ color: '#059669', fontWeight: 600, fontSize: '0.85rem' }}>
                                  ✓ Sold ({item.bidCount} Bids)
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="bid-row-right" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.45rem' }}>
                            <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
                              📅 Closed {closedDate}
                            </span>
                            <button
                              className="btn-primary"
                              style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleViewBuyer(item);
                              }}
                            >
                              <span>👤</span>
                              <span>View buyer details</span>
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* Tab 3: Not Attended (Unsold) with "Relist" button */}
              {panelTab === 'unsold' && (
                <div className="bids-list">
                  {unsoldAuctions.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-muted)' }}>
                      <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>⏱️</div>
                      <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                        No Unsold Auctions
                      </h3>
                      <p style={{ fontSize: '0.88rem', maxWidth: '380px', margin: '0 auto' }}>
                        Auctions that reached their deadline without any bids will appear here with a 1-click Relist action.
                      </p>
                    </div>
                  ) : (
                    unsoldAuctions.map((item) => {
                      const img = item.images && item.images.length > 0 && item.images[0]
                        ? item.images[0]
                        : 'https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?auto=format&fit=crop&w=400&q=80';
                      const endedDate = new Date(item.closesAt || item.createdAt || Date.now()).toLocaleDateString();

                      return (
                        <div
                          key={item._id}
                          className="bid-row-card"
                          onClick={() => onSelectAuction(item._id)}
                          style={{ cursor: 'pointer' }}
                        >
                          <div className="bid-row-left">
                            <img src={img} alt={item.title} className="bid-row-thumb" />
                            <div className="bid-row-info">
                              <div className="bid-row-title">{item.title}</div>
                              <div className="bid-row-pricing">
                                <span className="bid-row-cur-bid">Start Price: ₹{item.startPrice.toLocaleString()}</span>
                                <span>·</span>
                                <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                                  0 Bids (Unsold)
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="bid-row-right" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.45rem' }}>
                            <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                              Ended {endedDate}
                            </span>
                            <button
                              className="btn-outline-action"
                              style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem', borderColor: '#2563eb', color: '#2563eb' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenRelist(item);
                              }}
                            >
                              <span>🔄</span>
                              <span>Relist</span>
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Buyer Details Modal (Requirement 2 & 3) */}
      {viewingBuyerAuction && (
        <div
          className="modal-overlay"
          onClick={() => setViewingBuyerAuction(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: '12px',
              maxWidth: '460px',
              width: '100%',
              padding: '1.75rem',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.35rem' }}>👤</span>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>Winning Buyer Details</h3>
              </div>
              <button
                onClick={() => setViewingBuyerAuction(null)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.86rem', color: '#64748b', marginBottom: '1.25rem' }}>
              Item sold: <strong>{viewingBuyerAuction.title}</strong>
              <br />
              Winning Bid: <strong style={{ color: '#059669' }}>₹{viewingBuyerAuction.currentPrice || viewingBuyerAuction.startPrice}</strong>
            </p>

            {loadingBuyer ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                Loading verified buyer contact...
              </div>
            ) : buyerContact ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div style={{ background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                    Buyer Name
                  </div>
                  <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>{buyerContact.name}</div>
                </div>

                <div style={{ background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                    College Email
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 500, color: '#2563eb' }}>
                    <a href={`mailto:${buyerContact.collegeEmail}`} style={{ textDecoration: 'none', color: '#2563eb' }}>
                      {buyerContact.collegeEmail}
                    </a>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div style={{ background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                      Department
                    </div>
                    <div style={{ fontSize: '0.92rem', fontWeight: 600, color: '#0f172a' }}>{buyerContact.department}</div>
                  </div>
                  <div style={{ background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                      Year
                    </div>
                    <div style={{ fontSize: '0.92rem', fontWeight: 600, color: '#0f172a' }}>{buyerContact.year}</div>
                  </div>
                </div>

                <div style={{ background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                    Phone Number
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 600, color: buyerContact.phone ? '#059669' : '#94a3b8' }}>
                    {buyerContact.phone || 'Phone not shared by student'}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '1.5rem', color: '#ef4444' }}>
                Unable to load buyer information.
              </div>
            )}

            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="btn-primary"
                onClick={() => setViewingBuyerAuction(null)}
                style={{ padding: '0.5rem 1.25rem', borderRadius: '6px' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Relist Modal (Requirement 2 & 3) */}
      {relistingAuction && (
        <div
          className="modal-overlay"
          onClick={() => setRelistingAuction(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: '12px',
              maxWidth: '460px',
              width: '100%',
              padding: '1.75rem',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.35rem' }}>🔄</span>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>Relist Unsold Auction</h3>
              </div>
              <button
                onClick={() => setRelistingAuction(null)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.86rem', color: '#64748b', marginBottom: '1.25rem' }}>
              Prefilling details from: <strong>{relistingAuction.title}</strong>
            </p>

            <form onSubmit={handleRelistSubmit}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label className="form-label">Starting Price (₹)</label>
                <input
                  type="number"
                  className="input-field"
                  style={{ paddingLeft: '1rem' }}
                  min="1"
                  value={relistStartPrice}
                  onChange={(e) => setRelistStartPrice(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  required
                />
                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  You can lower the starting price to attract more bidders.
                </span>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label className="form-label">Auction Duration</label>
                <select
                  className="select-field"
                  value={relistDuration}
                  onChange={(e) => setRelistDuration(parseInt(e.target.value, 10))}
                >
                  <option value={1}>1 Minute (Fast Testing)</option>
                  <option value={15}>15 Minutes</option>
                  <option value={60}>1 Hour</option>
                  <option value={1440}>24 Hours (Standard)</option>
                  <option value={4320}>3 Days</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn-outline-action"
                  onClick={() => setRelistingAuction(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={relisting}
                  style={{ minWidth: '130px' }}
                >
                  {relisting ? 'Relisting...' : 'Relist Auction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
