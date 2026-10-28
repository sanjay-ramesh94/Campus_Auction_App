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

  const [selectedSellerModalAuction, setSelectedSellerModalAuction] = useState<Auction | null>(null);
  const [sellerContact, setSellerContact] = useState<{
    name: string;
    collegeEmail: string;
    department: string;
    year: string;
    phone: string | null;
  } | null>(null);
  const [loadingSeller, setLoadingSeller] = useState(false);

  const handleViewSeller = async (auction: Auction) => {
    setSelectedSellerModalAuction(auction);
    setSellerContact(null);
    setLoadingSeller(true);
    try {
      const res = await fetch(`/api/buyer/auctions/${auction._id}/seller`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok && data.seller) {
        setSellerContact(data.seller);
      } else {
        onShowToast('error', 'Seller Details', data.error || 'Failed to retrieve seller contact details');
        setSelectedSellerModalAuction(null);
      }
    } catch {
      onShowToast('error', 'Error', 'Failed to retrieve seller contact details');
      setSelectedSellerModalAuction(null);
    } finally {
      setLoadingSeller(false);
    }
  };

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
    const interval = setInterval(fetchMyBids, 2500);
    return () => clearInterval(interval);
  }, [token]);

  const activeBids = [...bidsData.leading, ...bidsData.outbid];

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
            <span>Won Items ({bidsData.won.length})</span>
          </button>
          <button
            className={`seller-menu-btn ${sidebarTab === 'lost' ? 'active' : ''}`}
            onClick={() => {
              setSidebarTab('lost');
              setSubTab('lost');
            }}
          >
            <span>⏱️</span>
            <span>Lost Items ({bidsData.lost.length})</span>
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

          {/* Subtabs bar matching Screen 5: Active, Won, Lost */}
          <div className="bids-filter-bar">
            <button
              className={`bid-filter-chip ${subTab === 'active' && sidebarTab !== 'watching' ? 'active' : ''}`}
              onClick={() => {
                setSubTab('active');
                setSidebarTab('my_bids');
              }}
            >
              Active ({activeBids.length})
            </button>
            <button
              className={`bid-filter-chip ${subTab === 'won' && sidebarTab !== 'watching' ? 'active' : ''}`}
              onClick={() => {
                setSubTab('won');
                setSidebarTab('won');
              }}
            >
              Won ({bidsData.won.length})
            </button>
            <button
              className={`bid-filter-chip ${subTab === 'lost' && sidebarTab !== 'watching' ? 'active' : ''}`}
              onClick={() => {
                setSubTab('lost');
                setSidebarTab('lost');
              }}
            >
              Lost ({bidsData.lost.length})
            </button>
          </div>

          {/* Watching View */}
          {sidebarTab === 'watching' && (
            <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>❤️</div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                Your Watchlist
              </h3>
              <p style={{ fontSize: '0.88rem', maxWidth: '380px', margin: '0 auto' }}>
                Auctions you are monitoring will appear here with instant live alerts.
              </p>
            </div>
          )}

          {/* Active Bids List */}
          {sidebarTab !== 'watching' && subTab === 'active' && (
            <div className="bids-list">
              {activeBids.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🏷️</div>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                    No Active Bids
                  </h3>
                  <p style={{ fontSize: '0.88rem', maxWidth: '380px', margin: '0 auto' }}>
                    You don't have any active bids on live auctions. Browse the live listings to start bidding!
                  </p>
                </div>
              ) : (
                activeBids.map((item: any) => {
                  const img = item.images && item.images.length > 0 && item.images[0]
                    ? item.images[0]
                    : 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=400&q=80';
                  const cur = item.currentPrice || item.startPrice;
                  const isLeading = item.isHighest !== undefined ? item.isHighest : bidsData.leading.some((l) => l._id === item._id);
                  const yourBid = item.yourBid || (isLeading ? cur : cur);

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
                              onSelectAuction(item._id);
                            }}
                          >
                            Increase Bid
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Won Items List */}
          {sidebarTab !== 'watching' && subTab === 'won' && (
            <div className="bids-list">
              {bidsData.won.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🏆</div>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                    No Won Auctions Yet
                  </h3>
                  <p style={{ fontSize: '0.88rem', maxWidth: '380px', margin: '0 auto' }}>
                    When you place the winning bid on an auction and it concludes, it will appear here with handover & pickup status!
                  </p>
                </div>
              ) : (
                bidsData.won.map((item: any) => {
                  const img = item.images && item.images.length > 0 && item.images[0]
                    ? item.images[0]
                    : 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=400&q=80';
                  const finalPrice = item.currentPrice || item.yourBid || item.startPrice;
                  const isApproved = item.approvalDecision === 'approved' || item.status === 'sold';
                  const isReserved = item.status === 'reserved';

                  let statusBadge = '✓ Won — Awaiting Seller Approval';
                  let statusBg = '#fffbeb';
                  let statusColor = '#d97706';
                  let pickupInfo = 'Awaiting seller review';

                  if (isApproved) {
                    statusBadge = '✓ Won & Approved';
                    statusBg = '#ecfdf5';
                    statusColor = '#059669';
                    pickupInfo = item.handoverNotes || 'Coordinate pickup with seller';
                  } else if (isReserved) {
                    statusBadge = '✓ Reserved for Pickup';
                    statusBg = '#f0f9ff';
                    statusColor = '#0284c7';
                    pickupInfo = item.handoverNotes || 'Pickup scheduled';
                  }

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
                            <span className="bid-row-cur-bid">Winning Bid: ₹{finalPrice.toLocaleString()}</span>
                            <span>·</span>
                            <span className="bid-row-your-bid highest">{statusBadge}</span>
                          </div>
                        </div>
                      </div>
                      <div className="bid-row-right" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.45rem' }}>
                        <div
                          style={{
                            fontSize: '0.82rem',
                            color: statusColor,
                            background: statusBg,
                            padding: '0.35rem 0.65rem',
                            borderRadius: '6px',
                            fontWeight: 600,
                            border: `1px solid ${statusColor}33`,
                          }}
                        >
                          {pickupInfo}
                        </div>
                        <button
                          className="btn-outline-action"
                          style={{ padding: '0.25rem 0.65rem', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewSeller(item);
                          }}
                        >
                          <span>👤</span>
                          <span>View Seller Details</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Lost Items List */}
          {sidebarTab !== 'watching' && subTab === 'lost' && (
            <div className="bids-list">
              {bidsData.lost.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>⏱️</div>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                    No Lost Auctions
                  </h3>
                  <p style={{ fontSize: '0.88rem', maxWidth: '380px', margin: '0 auto' }}>
                    Auctions where you were outbid or that ended without a winning bid will appear here.
                  </p>
                </div>
              ) : (
                bidsData.lost.map((item: any) => {
                  const img = item.images && item.images.length > 0 && item.images[0]
                    ? item.images[0]
                    : 'https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?auto=format&fit=crop&w=400&q=80';
                  const cur = item.currentPrice || item.startPrice;
                  const yourBid = item.yourBid || cur;

                  let reasonLabel = 'Outbid';
                  if (item.status === 'unsold') {
                    reasonLabel = 'Unsold';
                  } else if (item.approvalDecision === 'rejected') {
                    reasonLabel = 'Rejected by Seller';
                  } else if (item.status === 'closed') {
                    reasonLabel = 'Auction Closed';
                  }

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
                            <span className="bid-row-cur-bid">Final Price: ₹{cur.toLocaleString()}</span>
                            <span>·</span>
                            <span style={{ color: '#64748b', fontSize: '0.8rem' }}>
                              Your Bid: ₹{yourBid.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="bid-row-right">
                        <span
                          style={{
                            fontSize: '0.82rem',
                            color: '#94a3b8',
                            background: 'var(--bg-secondary)',
                            padding: '0.35rem 0.65rem',
                            borderRadius: '6px',
                            fontWeight: 500,
                          }}
                        >
                          {reasonLabel}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </main>
      </div>

      {/* Seller Contact Details Modal (Requirement 4) */}
      {selectedSellerModalAuction && (
        <div
          className="modal-overlay"
          onClick={() => setSelectedSellerModalAuction(null)}
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
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>Seller Contact Details</h3>
              </div>
              <button
                onClick={() => setSelectedSellerModalAuction(null)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.86rem', color: '#64748b', marginBottom: '1.25rem' }}>
              Item won: <strong>{selectedSellerModalAuction.title}</strong>
            </p>

            {loadingSeller ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                Loading verified seller contact...
              </div>
            ) : sellerContact ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div style={{ background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                    Seller Name
                  </div>
                  <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>{sellerContact.name}</div>
                </div>

                <div style={{ background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                    College Email
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 500, color: '#2563eb' }}>
                    <a href={`mailto:${sellerContact.collegeEmail}`} style={{ textDecoration: 'none', color: '#2563eb' }}>
                      {sellerContact.collegeEmail}
                    </a>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div style={{ background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                      Department
                    </div>
                    <div style={{ fontSize: '0.92rem', fontWeight: 600, color: '#0f172a' }}>{sellerContact.department}</div>
                  </div>
                  <div style={{ background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                      Year
                    </div>
                    <div style={{ fontSize: '0.92rem', fontWeight: 600, color: '#0f172a' }}>{sellerContact.year}</div>
                  </div>
                </div>

                <div style={{ background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                    Phone Number
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 600, color: sellerContact.phone ? '#059669' : '#94a3b8' }}>
                    {sellerContact.phone || 'Phone not shared by seller'}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '1.5rem', color: '#ef4444' }}>
                Unable to load seller contact information.
              </div>
            )}

            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="btn-primary"
                onClick={() => setSelectedSellerModalAuction(null)}
                style={{ padding: '0.5rem 1.25rem', borderRadius: '6px' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
