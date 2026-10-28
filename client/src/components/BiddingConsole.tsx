import React, { useState, useEffect } from 'react';
import type { Auction, Bid, UserPersona } from '../types';

interface BiddingConsoleProps {
  auction: Auction | null;
  currentPersona: UserPersona;
  onBidPlaced: () => void;
  showToast: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
}

export const BiddingConsole: React.FC<BiddingConsoleProps> = ({
  auction,
  currentPersona,
  onBidPlaced,
  showToast,
}) => {
  const [bids, setBids] = useState<Bid[]>([]);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [autoBidMax, setAutoBidMax] = useState<string>('');
  const [existingAutoBid, setExistingAutoBid] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [timeLeft, setTimeLeft] = useState<number>(0);

  // Update countdown timer
  useEffect(() => {
    if (!auction) return;
    const update = () => {
      setTimeLeft(Math.max(0, new Date(auction.closesAt).getTime() - Date.now()));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [auction?.closesAt]);

  // Fetch bids audit trail & existing auto-bid when auction or persona changes
  useEffect(() => {
    if (!auction) return;

    fetch(`/api/bids?auctionId=${auction._id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) setBids(data.bids || []);
      })
      .catch(console.error);

    fetch(`/api/auto-bids?auctionId=${auction._id}&userId=${currentPersona.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.autoBid) {
          setExistingAutoBid(data.autoBid.maxAmount);
          setAutoBidMax(String(data.autoBid.maxAmount));
        } else {
          setExistingAutoBid(null);
          setAutoBidMax('');
        }
      })
      .catch(console.error);
  }, [auction?._id, auction?.version, currentPersona.id]);

  if (!auction) {
    return (
      <div className="workspace-panel">
        <div className="workspace-placeholder">
          <div className="placeholder-emoji">🏷️</div>
          <h3>Select an item from the catalog</h3>
          <p>Click any auction card on the left to inspect bid history, test concurrent transactions, or configure proxy auto-bidding.</p>
        </div>
      </div>
    );
  }

  const currentPrice = auction.currentPrice ?? auction.startPrice;
  const nextMin = auction.currentPrice === null
    ? auction.startPrice
    : Math.min(auction.currentPrice + auction.minIncrement, auction.maxPrice);

  const isCritical = timeLeft > 0 && timeLeft <= 30000;
  const isWinning = auction.leaderId === currentPersona.id;

  const handlePlaceBid = async (amount: number) => {
    if (loading) return;
    setLoading(true);

    try {
      const idempotencyKey = `${currentPersona.id}-${auction._id}-${Date.now()}`;
      const res = await fetch('/api/bids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auctionId: auction._id,
          bidderId: currentPersona.id,
          amount,
          idempotencyKey,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        showToast('success', 'Bid Accepted!', `You placed ₹${amount.toLocaleString()} on ${auction.title}`);
        if (data.extendedDeadline) {
          showToast('warning', '🛡️ Anti-Sniping Triggered!', 'Deadline automatically extended by +60 seconds!');
        }
        if (data.autoBidsPlaced && data.autoBidsPlaced.length > 0) {
          showToast('info', '🤖 Auto-Bid War!', `${data.autoBidsPlaced.length} automated proxy bid(s) placed!`);
        }
        setCustomAmount('');
        onBidPlaced();
      } else {
        showToast('error', 'Bid Rejected', data.error || data.reason || 'Could not place bid');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showToast('error', 'Network Error', message);
    } finally {
      setLoading(false);
    }
  };

  const handleSetAutoBid = async () => {
    const maxVal = parseInt(autoBidMax, 10);
    if (!maxVal || maxVal <= currentPrice) {
      showToast('warning', 'Invalid Cap', `Auto-bid cap must be higher than current price (₹${currentPrice})`);
      return;
    }

    try {
      const res = await fetch('/api/auto-bids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auctionId: auction._id,
          userId: currentPersona.id,
          maxAmount: maxVal,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        setExistingAutoBid(maxVal);
        showToast('success', 'Auto-Bid Configured!', `Engine will proxy bid for you up to ₹${maxVal.toLocaleString()}`);
      } else {
        showToast('error', 'Error', data.error || 'Failed to save auto-bid');
      }
    } catch (err: unknown) {
      showToast('error', 'Error', String(err));
    }
  };

  return (
    <div className="workspace-panel">
      {/* Header */}
      <div className="detail-header">
        <div>
          <span className="card-category">{auction.category}</span>
          <h2 className="card-title" style={{ fontSize: '1.4rem' }}>{auction.title}</h2>
          <p className="card-desc">{auction.description}</p>
        </div>
        {isCritical && (
          <span className="anti-snipe-badge">
            🛡️ Anti-Sniping Window (&lt;30s)
          </span>
        )}
      </div>

      {/* Price & Timer Grid */}
      <div className="price-display-bar">
        <div className="price-box">
          <span className="price-box-label">Current Price</span>
          <span className="price-box-val green">₹{currentPrice.toLocaleString()}</span>
          <span style={{ fontSize: '0.75rem', color: isWinning ? '#10b981' : '#94a3b8' }}>
            {isWinning ? '👑 You are winning!' : 'Not current leader'}
          </span>
        </div>

        <div className="price-box">
          <span className="price-box-label">Time Remaining</span>
          <span className={`price-box-val ${isCritical ? 'timer-critical' : 'timer'}`}>
            {Math.floor(timeLeft / 60000)}m {Math.floor((timeLeft % 60000) / 1000)}s
          </span>
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
            Server authoritative
          </span>
        </div>

        <div className="price-box">
          <span className="price-box-label">Next Min Bid</span>
          <span className="price-box-val">₹{nextMin.toLocaleString()}</span>
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
            Max Cap: ₹{auction.maxPrice.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Transactional Bidding Controls */}
      <div className="bidding-controls">
        <div className="quick-row">
          <button
            className="btn btn-action"
            type="button"
            disabled={loading || timeLeft <= 0 || nextMin > auction.maxPrice}
            onClick={() => handlePlaceBid(nextMin)}
          >
            Bid Next Min: ₹{nextMin.toLocaleString()}
          </button>

          <div className="quick-chips">
            {[50, 100, 250].map((inc) => (
              <button
                key={inc}
                className="chip"
                type="button"
                disabled={loading || timeLeft <= 0}
                onClick={() => handlePlaceBid(currentPrice + inc)}
              >
                +₹{inc}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Input */}
        <form
          className="custom-form"
          onSubmit={(e) => {
            e.preventDefault();
            const val = parseInt(customAmount, 10);
            if (val) handlePlaceBid(val);
          }}
        >
          <div className="input-wrap">
            <span className="currency-affix">₹</span>
            <input
              type="number"
              className="custom-input"
              placeholder={`Custom amount (min ₹${nextMin})`}
              min={nextMin}
              max={auction.maxPrice}
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              disabled={loading || timeLeft <= 0}
            />
          </div>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={loading || !customAmount || timeLeft <= 0}
          >
            {loading ? 'Submitting...' : 'Place Bid'}
          </button>
        </form>

        {/* Auto-Bid Proxy Card */}
        <div className="autobid-section">
          <div className="autobid-title">
            <span>🤖 Proxy Auto-Bid Engine</span>
          </div>
          <p className="autobid-desc">
            Set your secret ceiling. If anyone outbids you, the server automatically increments by ₹{auction.minIncrement} inside the transaction until your limit is reached.
          </p>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <div className="input-wrap">
              <span className="currency-affix">₹</span>
              <input
                type="number"
                className="custom-input"
                placeholder="Maximum budget cap (e.g. 2500)"
                value={autoBidMax}
                onChange={(e) => setAutoBidMax(e.target.value)}
              />
            </div>
            <button className="btn btn-secondary" type="button" onClick={handleSetAutoBid}>
              {existingAutoBid ? 'Update Cap' : 'Set Cap'}
            </button>
          </div>

          {existingAutoBid && (
            <div style={{ fontSize: '0.75rem', color: '#10b981' }}>
              ✅ Active Auto-Bid: Engine will bid up to ₹{existingAutoBid.toLocaleString()} for {currentPersona.name}
            </div>
          )}
        </div>
      </div>

      {/* Real-time Bid History Audit Trail */}
      <div className="audit-section">
        <div className="audit-title">Live Transaction Audit Log ({bids.length} Bids)</div>
        <ul className="audit-list">
          {bids.length === 0 ? (
            <li style={{ fontSize: '0.85rem', color: '#64748b' }}>No bids yet. Be the first to start!</li>
          ) : (
            bids.map((b, idx) => (
              <li key={b._id || idx} className="audit-item">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className={`audit-source ${b.source}`}>{b.source}</span>
                  <span style={{ fontWeight: 700, color: '#f8fafc' }}>₹{b.amount.toLocaleString()}</span>
                  <span style={{ color: '#94a3b8' }}>
                    by {b.bidderId === currentPersona.id ? 'You' : b.bidderId.slice(-4)}
                  </span>
                </div>
                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                  {new Date(b.serverTs).toLocaleTimeString()}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
};
