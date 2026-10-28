import React, { useState, useEffect } from 'react';
import type { Auction, User } from '../types';

interface BuyerHomeProps {
  user: User;
  token: string | null;
  searchQuery: string;
  onSelectAuction: (auctionId: string) => void;
  onShowToast: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
}

export const BuyerHome: React.FC<BuyerHomeProps> = ({
  searchQuery,
  onSelectAuction,
}) => {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [sortBy, setSortBy] = useState<string>('closing_soon');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  const categories = [
    { label: 'All', icon: '🏷️' },
    { label: 'Electronics', icon: '💻' },
    { label: 'Bicycles', icon: '🚲' },
    { label: 'Furniture', icon: '🪑' },
    { label: 'Books', icon: '📚' },
    { label: 'Hostel Essentials', icon: '🛏️' },
    { label: 'Others', icon: '📦' },
  ];

  const fetchAuctions = async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      if (selectedCategory !== 'All') params.append('category', selectedCategory);
      if (sortBy) params.append('sort', sortBy);

      const res = await fetch(`/api/browse?${params.toString()}`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.auctions)) {
        setAuctions(data.auctions);
      }
    } catch {}
  };

  useEffect(() => {
    fetchAuctions();
    const interval = setInterval(fetchAuctions, 5000);
    return () => clearInterval(interval);
  }, [searchQuery, selectedCategory, sortBy]);

  const toggleFavorite = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatCountdown = (closesAtStr: string) => {
    const diff = new Date(closesAtStr).getTime() - Date.now();
    if (diff <= 0) return 'Closed';
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / 1000 / 60) % 60);
    const seconds = Math.floor((diff / 1000) % 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m ${seconds}s`;
  };

  return (
    <div className="app-body-container">
      <div className="listings-layout">
        {/* Left Sidebar: Categories */}
        <aside className="category-sidebar">
          {categories.map((c) => (
            <button
              key={c.label}
              className={`category-item ${selectedCategory === c.label ? 'active' : ''}`}
              onClick={() => setSelectedCategory(c.label)}
            >
              <span className="category-item-icon">{c.icon}</span>
              <span>{c.label}</span>
            </button>
          ))}
        </aside>

        {/* Right Content Area: Header & 4-Column Grid */}
        <main>
          <div className="listings-main-header">
            <div>
              <h2 className="listings-title">All Listings</h2>
              <p className="listings-subtitle">Find great deals from your fellow students.</p>
            </div>

            <select
              className="sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="closing_soon">Ending Soon</option>
              <option value="price_low">Price: Low to High</option>
              <option value="price_high">Price: High to Low</option>
              <option value="created_at">Newly Listed</option>
            </select>
          </div>

          {auctions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '4rem 1rem', background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '2.5rem' }}>🔍</span>
              <h3 style={{ marginTop: '0.75rem', fontWeight: 700 }}>No listings found</h3>
              <p style={{ color: '#64748b', fontSize: '0.88rem' }}>
                Try selecting "All" categories or clearing your search term.
              </p>
            </div>
          ) : (
            <div className="auction-grid">
              {auctions.map((a) => {
                const img = a.images && a.images.length > 0
                  ? a.images[0]
                  : 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=600&q=80';
                const curPrice = a.currentPrice || a.startPrice;
                const isFav = favorites.has(a._id);

                return (
                  <div
                    key={a._id}
                    className="mockup-card"
                    onClick={() => onSelectAuction(a._id)}
                  >
                    {/* Card Photo Container */}
                    <div className="mockup-card-img-wrapper">
                      <img src={img} alt={a.title} className="mockup-card-img" />

                      {/* Favorite Button */}
                      <button
                        className={`mockup-card-fav-btn ${isFav ? 'active' : ''}`}
                        onClick={(e) => toggleFavorite(e, a._id)}
                        title="Add to Watchlist"
                      >
                        {isFav ? '❤️' : '🤍'}
                      </button>

                      {/* Live Timer Pill */}
                      <div className="mockup-card-countdown-badge">
                        <span>⏱</span>
                        <span>{formatCountdown(a.closesAt)}</span>
                      </div>
                    </div>

                    {/* Card Body */}
                    <div className="mockup-card-body">
                      <div>
                        <div className="mockup-card-category">{a.category}</div>
                        <h3 className="mockup-card-title">{a.title}</h3>
                      </div>

                      <div className="mockup-card-footer">
                        <div className="mockup-card-price">₹{curPrice.toLocaleString()}</div>
                        <div className="mockup-card-bids">{a.bidCount} bids</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
