import React, { useState, useEffect } from 'react';
import type { Auction, UserPersona } from '../types';

interface AuctionCardProps {
  auction: Auction;
  isSelected: boolean;
  currentPersona: UserPersona;
  onSelect: (auction: Auction) => void;
}

export const AuctionCard: React.FC<AuctionCardProps> = ({
  auction,
  isSelected,
  currentPersona,
  onSelect,
}) => {
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    const update = () => {
      const remaining = Math.max(0, new Date(auction.closesAt).getTime() - Date.now());
      setTimeLeft(remaining);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [auction.closesAt]);

  const formatTimer = (ms: number) => {
    if (ms <= 0) return 'Closed';
    const totalSecs = Math.floor(ms / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const isCritical = timeLeft > 0 && timeLeft <= 30000;
  const isLeader = auction.leaderId === currentPersona.id;
  const currentPrice = auction.currentPrice ?? auction.startPrice;

  return (
    <div
      className={`auction-card ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelect(auction)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect(auction);
      }}
    >
      <div className="card-top">
        <div>
          <span className="card-category">{auction.category}</span>
          <h3 className="card-title">{auction.title}</h3>
        </div>
        {isCritical && (
          <span className="anti-snipe-badge">
            🛡️ &lt;30s (Anti-Snipe)
          </span>
        )}
      </div>

      <p className="card-desc">{auction.description || 'No description provided.'}</p>

      <div className="card-stats">
        <div>
          <div className="card-stat-label">Current Bid</div>
          <div className="card-stat-val price">₹{currentPrice.toLocaleString()}</div>
        </div>
        <div>
          <div className="card-stat-label">Time Remaining</div>
          <div className={`card-stat-val ${isCritical ? 'timer-critical' : ''}`}>
            {formatTimer(timeLeft)}
          </div>
        </div>
        <div>
          <div className="card-stat-label">Min Increment</div>
          <div className="card-stat-val">₹{auction.minIncrement}</div>
        </div>
      </div>

      <div className="card-footer">
        <span>{auction.bidCount} bid{auction.bidCount === 1 ? '' : 's'} recorded</span>
        {auction.leaderId ? (
          <span className={`leader-tag ${isLeader ? 'winning' : ''}`}>
            {isLeader ? '👑 Winning' : 'Outbid'}
          </span>
        ) : (
          <span className="leader-tag">First bid opens at ₹{auction.startPrice}</span>
        )}
      </div>
    </div>
  );
};
