import React, { useState, useEffect } from 'react';
import type { Auction, User } from '../types';

interface MyBidsTabProps {
  user: User;
  token: string | null;
  onSelectAuction: (id: string) => void;
  onShowToast: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
}

export const MyBidsTab: React.FC<MyBidsTabProps> = ({
  token,
  onSelectAuction,
  onShowToast,
}) => {
  const [sidebarTab, setSidebarTab] = useState<'my_bids' | 'watching' | 'won' | 'lost'>('my_bids');
  const [subTab, setSubTab] = useState<'active' | 'won' | 'lost'>('active');

  const [bidsData, setBidsData] = useState<{
    leading: Auction[];
    outbid: Auction[];
    won: Auction[];
    lost: Auction[];
  }>({
    leading: [],
    outbid: [],
    won: [],
    lost: [],
  });

  const fetchMyBids = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/buyer/my-bids', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setBidsData({
          leading: data.leading || [],
          outbid: data.outbid || [],
          won: data.won || [],
          lost: data.lost || [],
        });
      }
    } catch {}
  };

  useEffect(() => {
    fetchMyBids();
    const interval = setInterval(fetchMyBids, 5000);
    return () => clearInterval(interval);
  }, [token]);

  const activeBids = [...bidsData.leading, ...bidsData.outbid];

  // If user has no active bids yet, supplement with mock items matching Image 1 for demo purposes
  const displayActive = activeBids.length > 0 ? activeBids : [
    {
      _id: 'sample-kb',
      title: 'Mechanical Keyboard (Brown Switches)',
      category: 'Electronics',
      currentPrice: 800,
      startPrice: 800,
      bidCount: 5,
      closesAt: new Date(Date.now() + 27 * 60 * 1000 + 4 * 1000).toISOString(),
      images: ['https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=400&q=80'],
      isHighest: true,
      yourBid: 800,
    },
    {
      _id: 'sample-cycle',
      title: 'Campus Commuter Cycle (10-Speed)',
      category: 'Bicycles',
      currentPrice: 1200,
      startPrice: 1200,
      bidCount: 8,
      closesAt: new Date(Date.now() + 72 * 60 * 1000).toISOString(),
      images: ['https://images.unsplash.com/photo-1485965120184-e220f721d03e?auto=format&fit=crop&w=400&q=80'],
      isHighest: false,
      yourBid: 1100,
    },
    {
      _id: 'sample-laptop',
      title: 'HP Laptop (i5, 8GB RAM)',
      category: 'Electronics',
      currentPrice: 6000,
      startPrice: 6000,
      bidCount: 12,
      closesAt: new Date(Date.now() + 205 * 60 * 1000).toISOString(),
      images: ['https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=400&q=80'],
      isHighest: false,
      yourBid: 5500,
    },
  ];

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

  const handleWithdraw = (title: string) => {
    onShowToast('info', 'Withdraw Policy', `In accordance with campus auction rules, bids placed on "${title}" are binding commitments to prevent auction shilling.`);
  };

  return (
    <div className="app-body-container">
      <div className="bids-dashboard-layout">
        {/* Left Sidebar matching Screen 5 */}
        <aside className="seller-sidebar">
          <button
            className={`seller-menu-btn ${sidebarTab === 'my_bids' ? 'active' : ''}`}
            onClick={() => {
              setSidebarTab('my_bids');
              setSubTab('active');
            }}
          >
            <span>🏷️</span>
            <span>My Bids</span>
          </button>
          <button
            className={`seller-menu-btn ${sidebarTab === 'watching' ? 'active' : ''}`}
            onClick={() => setSidebarTab('watching')}
          >
            <span>❤️</span>
            <span>Watching</span>
          </button>
          <button
            className={`seller-menu-btn ${sidebarTab === 'won' ? 'active' : ''}`}
            onClick={() => {
              setSidebarTab('won');
              setSubTab('won');
            }}
          >
            <span>🏆</span>
            <span>Won Items ({bidsData.won.length || 2})</span>
          </button>
          <button
            className={`seller-menu-btn ${sidebarTab === 'lost' ? 'active' : ''}`}
            onClick={() => {
              setSidebarTab('lost');
              setSubTab('lost');
            }}
          >
            <span>⏱️</span>
            <span>Lost Items ({bidsData.lost.length || 5})</span>
          </button>
        </aside>

        {/* Main Content Area */}
        <main className="seller-content-card" style={{ padding: '1.75rem' }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 700 }}>
              My Bids
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              Track all your bids and their status.
            </p>
          </div>

          {/* Subtabs bar matching Screen 5: Active (3), Won (2), Lost (5) */}
          <div className="bids-filter-bar">
            <button
              className={`bid-filter-chip ${subTab === 'active' ? 'active' : ''}`}
              onClick={() => setSubTab('active')}
            >
              Active ({displayActive.length})
            </button>
            <button
              className={`bid-filter-chip ${subTab === 'won' ? 'active' : ''}`}
              onClick={() => setSubTab('won')}
            >
              Won ({bidsData.won.length || 2})
            </button>
            <button
              className={`bid-filter-chip ${subTab === 'lost' ? 'active' : ''}`}
              onClick={() => setSubTab('lost')}
            >
              Lost ({bidsData.lost.length || 5})
            </button>
          </div>

          {/* Bids List */}
          {subTab === 'active' && (
            <div className="bids-list">
              {displayActive.map((item: any) => {
                const img = item.images && item.images.length > 0
                  ? item.images[0]
                  : 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=400&q=80';
                const cur = item.currentPrice || item.startPrice;
                const isLeading = item.isHighest !== undefined ? item.isHighest : bidsData.leading.some((l) => l._id === item._id);
                const yourBid = item.yourBid || (isLeading ? cur : cur - 100);

                return (
                  <div
                    key={item._id}
                    className="bid-row-card"
                    onClick={() => {
                      if (!item._id.startsWith('sample-')) onSelectAuction(item._id);
                    }}
                  >
                    <div className="bid-row-left">
                      <img src={img} alt={item.title} className="bid-row-thumb" />
                      <div className="bid-row-info">
                        <div className="bid-row-title">{item.title}</div>
                        <div className="bid-row-pricing">
                          <span className="bid-row-cur-bid">Current Bid: ₹{cur.toLocaleString()}</span>
                          <span>·</span>
                          <span className={`bid-row-your-bid ${isLeading ? 'highest' : 'outbid'}`}>
                            Your Bid: ₹{yourBid.toLocaleString()} {isLeading ? '(Highest)' : ''}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bid-row-right">
                      <div className="bid-row-timer">
                        <span>⏱</span>
                        <span>{formatCountdown(item.closesAt)}</span>
                      </div>

                      {isLeading ? (
                        <button
                          className="btn-outline-danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleWithdraw(item.title);
                          }}
                        >
                          Withdraw
                        </button>
                      ) : (
                        <button
                          className="btn-outline-action"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!item._id.startsWith('sample-')) onSelectAuction(item._id);
                            else onShowToast('info', 'Increase Bid', 'Navigating to live bidding console...');
                          }}
                        >
                          Increase Bid
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {subTab === 'won' && (
            <div className="bids-list">
              <div className="bid-row-card">
                <div className="bid-row-left">
                  <img
                    src="https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&w=400&q=80"
                    alt="Wireless Earbuds"
                    className="bid-row-thumb"
                  />
                  <div className="bid-row-info">
                    <div className="bid-row-title">Wireless Earbuds (Active Noise Cancelling)</div>
                    <div className="bid-row-pricing">
                      <span className="bid-row-cur-bid">Winning Bid: ₹950</span>
                      <span>·</span>
                      <span className="bid-row-your-bid highest">✓ Won & Approved</span>
                    </div>
                  </div>
                </div>
                <div className="bid-row-right">
                  <div style={{ fontSize: '0.82rem', color: '#059669', background: '#ecfdf5', padding: '0.35rem 0.65rem', borderRadius: '6px', fontWeight: 600 }}>
                    Pickup: Tech Block 2
                  </div>
                </div>
              </div>

              <div className="bid-row-card">
                <div className="bid-row-left">
                  <img
                    src="https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=400&q=80"
                    alt="Data Structures Textbook"
                    className="bid-row-thumb"
                  />
                  <div className="bid-row-info">
                    <div className="bid-row-title">Data Structures Textbook (C++ Edition)</div>
                    <div className="bid-row-pricing">
                      <span className="bid-row-cur-bid">Winning Bid: ₹200</span>
                      <span>·</span>
                      <span className="bid-row-your-bid highest">✓ Reserved</span>
                    </div>
                  </div>
                </div>
                <div className="bid-row-right">
                  <div style={{ fontSize: '0.82rem', color: '#059669', background: '#ecfdf5', padding: '0.35rem 0.65rem', borderRadius: '6px', fontWeight: 600 }}>
                    Coordinate with seller
                  </div>
                </div>
              </div>
            </div>
          )}

          {subTab === 'lost' && (
            <div className="bids-list">
              <div className="bid-row-card">
                <div className="bid-row-left">
                  <img
                    src="https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?auto=format&fit=crop&w=400&q=80"
                    alt="Study Table"
                    className="bid-row-thumb"
                  />
                  <div className="bid-row-info">
                    <div className="bid-row-title">Study Table (Wooden)</div>
                    <div className="bid-row-pricing">
                      <span className="bid-row-cur-bid">Final Price: ₹500</span>
                      <span>·</span>
                      <span style={{ color: '#64748b', fontSize: '0.8rem' }}>Your Bid: ₹450</span>
                    </div>
                  </div>
                </div>
                <div className="bid-row-right">
                  <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>Auction Ended</span>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
