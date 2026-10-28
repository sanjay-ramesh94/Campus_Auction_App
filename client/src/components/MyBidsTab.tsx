import React, { useState, useEffect } from 'react';
import type { Auction } from '../types';

interface MyBidsTabProps {
  token: string;
  onSelectAuction: (auction: Auction) => void;
}

export const MyBidsTab: React.FC<MyBidsTabProps> = ({ token, onSelectAuction }) => {
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

  const [activeSubTab, setActiveSubTab] = useState<'leading' | 'outbid' | 'won' | 'lost'>('leading');
  const [loading, setLoading] = useState(true);

  const fetchMyBids = async () => {
    try {
      const res = await fetch('/api/buyer/my-bids', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setBidsData(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMyBids();
    const timer = setInterval(fetchMyBids, 4000);
    return () => clearInterval(timer);
  }, [token]);

  const currentList = bidsData[activeSubTab] || [];

  return (
    <div className="my-bids-layout">
      <div className="tab-header-box">
        <h2>My Bids & Auction Outcomes</h2>
        <p>Track your live bids, outbid alerts, and won items ready for campus pickup.</p>
      </div>

      {/* Sub Tabs */}
      <div className="seller-tabs-bar" style={{ marginTop: '1rem' }}>
        <button
          className={`seller-tab ${activeSubTab === 'leading' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('leading')}
        >
          👑 Leading ({bidsData.leading.length})
        </button>
        <button
          className={`seller-tab ${activeSubTab === 'outbid' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('outbid')}
        >
          ⚠️ Outbid ({bidsData.outbid.length})
        </button>
        <button
          className={`seller-tab ${activeSubTab === 'won' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('won')}
        >
          🎉 Won ({bidsData.won.length})
        </button>
        <button
          className={`seller-tab ${activeSubTab === 'lost' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('lost')}
        >
          ❌ Lost ({bidsData.lost.length})
        </button>
      </div>

      {/* Listings List */}
      <div className="my-bids-cards-grid" style={{ marginTop: '1.25rem' }}>
        {loading ? (
          <p>Loading your bids...</p>
        ) : currentList.length === 0 ? (
          <div className="empty-catalog-card">
            <p>No auctions in "{activeSubTab.toUpperCase()}".</p>
          </div>
        ) : (
          currentList.map((item) => (
            <div key={item._id} className="buyer-card">
              <div className="card-top">
                <span className="card-category">{item.category}</span>
                <span className="price-tag" style={{ color: '#10b981', fontWeight: 700 }}>
                  ₹{item.currentPrice?.toLocaleString()}
                </span>
              </div>

              <h4 className="buyer-card-title">{item.title}</h4>
              <p className="buyer-card-desc">{item.description}</p>

              {/* Won Details */}
              {activeSubTab === 'won' && (
                <div className="won-status-banner">
                  {item.status === 'pending_approval' && (
                    <span style={{ color: '#f59e0b' }}>
                      ⏳ Highest bid! Waiting for seller to approve the outcome.
                    </span>
                  )}
                  {item.status === 'reserved' && (
                    <span style={{ color: '#10b981' }}>
                      ✅ Approved! Status: Reserved. Coordinate with seller for campus pickup.
                    </span>
                  )}
                  {item.status === 'sold' && (
                    <span style={{ color: '#06b6d4' }}>
                      🤝 Handover confirmed! Transaction complete.
                    </span>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem' }}
                  onClick={() => onSelectAuction(item)}
                >
                  View Listing Details →
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
