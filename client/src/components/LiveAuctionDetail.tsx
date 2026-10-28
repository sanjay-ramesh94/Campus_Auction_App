import React, { useState, useEffect } from 'react';
import type { Auction, User, LiveBidParticipant, Question, BidHistoryItem, PublicPresenceUser } from '../types';

interface LiveAuctionDetailProps {
  auctionId: string;
  user: User;
  token: string | null;
  onBackToListings: () => void;
  onShowToast: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
}

export const LiveAuctionDetail: React.FC<LiveAuctionDetailProps> = ({
  auctionId,
  user,
  token,
  onBackToListings,
  onShowToast,
}) => {
  const [auction, setAuction] = useState<Auction | null>(null);
  const [seller, setSeller] = useState<{ id: string; name: string; yearBranch: string; verified: boolean } | null>(null);
  const [participants, setParticipants] = useState<LiveBidParticipant[]>([]);
  const [uniqueCount, setUniqueCount] = useState<number>(0);
  const [currentHighestBid, setCurrentHighestBid] = useState<number>(0);

  // Live Bid History state
  const [bids, setBids] = useState<BidHistoryItem[]>([]);
  const [bidsTotal, setBidsTotal] = useState<number>(0);
  const [bidsPage, setBidsPage] = useState<number>(1);
  const bidsLimit = 10;
  const [filterBidderId, setFilterBidderId] = useState<string | null>(null);
  const [totalBidsCount, setTotalBidsCount] = useState<number>(0);

  // Temporary Live Room Presence (In-memory presence)
  const [presenceUsers, setPresenceUsers] = useState<PublicPresenceUser[]>([]);
  const [presentTotal, setPresentTotal] = useState<number>(0);
  const [presentActive, setPresentActive] = useState<number>(0);
  const [presentAway, setPresentAway] = useState<number>(0);

  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [isFavorite, setIsFavorite] = useState(false);
  const [bidAmount, setBidAmount] = useState<number>(0);
  const [bidding, setBidding] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Active avatar popover
  const [activePopoverId, setActivePopoverId] = useState<string | null>(null);

  // Q&A
  const [questions, setQuestions] = useState<Question[]>([]);
  const [newQuestionText, setNewQuestionText] = useState('');
  const [similarQuestion, setSimilarQuestion] = useState<string | null>(null);
  const [answeringQId, setAnsweringQId] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState('');

  // Auto-bid proxy
  const [showAutoBid, setShowAutoBid] = useState(false);
  const [autoBidMax, setAutoBidMax] = useState<number>(0);

  const [timeLeft, setTimeLeft] = useState<{ m: number; s: number; formatted: string }>({
    m: 27,
    s: 4,
    formatted: '27m 4s',
  });

  // Only students who are currently live/online in the auction room
  const unifiedParticipants = React.useMemo(() => {
    // presenceUsers contains all users with this auction open right now
    const activeList = presenceUsers.map((pu, idx) => {
      // Find if this live user has placed bids on this auction
      const bidderInfo = participants.find((p) => p.id === pu.userId);
      const isLeader = pu.isLeader || (bidderInfo && bidderInfo.status === 'leading');

      return {
        id: pu.userId,
        name: pu.name,
        initials: pu.initials,
        yearBranch: bidderInfo ? bidderInfo.yearBranch : 'Live in room',
        highestBid: bidderInfo ? bidderInfo.highestBid : 0,
        bidCount: bidderInfo ? bidderInfo.bidCount : 0,
        status: isLeader ? ('leading' as const) : ('outbid' as const),
        isYou: Boolean(user && user.id === pu.userId),
        isBidder: Boolean(bidderInfo && bidderInfo.bidCount > 0),
        isOnline: true,
        isVisible: pu.isVisible,
        colorClass:
          user && user.id === pu.userId
            ? 'avatar-color-0'
            : `avatar-color-${(idx + 1) % 7}`,
      };
    });

    // Sort: Leading bidder first, then other active bidders by highest bid, then spectators, then away
    activeList.sort((a, b) => {
      if (a.status === 'leading' && b.status !== 'leading') return -1;
      if (a.status !== 'leading' && b.status === 'leading') return 1;
      if (a.isBidder && !b.isBidder) return -1;
      if (!a.isBidder && b.isBidder) return 1;
      if (b.highestBid !== a.highestBid) return b.highestBid - a.highestBid;
      if (a.isVisible && !b.isVisible) return -1;
      if (!a.isVisible && b.isVisible) return 1;
      return a.name.localeCompare(b.name);
    });

    return activeList;
  }, [presenceUsers, participants, user]);

  // Human-readable local timestamp formatter with date when appropriate
  const formatBidTimestamp = (isoString: string): string => {
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return 'Recently';

      const now = new Date();
      const isToday =
        d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear();

      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      if (isToday) {
        return `Today at ${timeStr}`;
      }

      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const isYesterday =
        d.getDate() === yesterday.getDate() &&
        d.getMonth() === yesterday.getMonth() &&
        d.getFullYear() === yesterday.getFullYear();

      if (isYesterday) {
        return `Yesterday at ${timeStr}`;
      }

      const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      return `${dateStr}, ${timeStr}`;
    } catch {
      return 'Recently';
    }
  };

  // Fetch auction details
  const fetchDetails = async () => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/auctions/${auctionId}`, { headers });
      const data = await res.json();

      if (data.ok && data.auction) {
        setAuction(data.auction);
        if (data.seller) setSeller(data.seller);
        if (data.participants) setParticipants(data.participants);
        if (typeof data.uniqueCount === 'number') setUniqueCount(data.uniqueCount);
        if (typeof data.totalBidsCount === 'number') setTotalBidsCount(data.totalBidsCount);
        if (data.currentHighestBid) setCurrentHighestBid(data.currentHighestBid);
        if (data.presence) {
          setPresenceUsers(data.presence.users || []);
          setPresentTotal(data.presence.totalPresent || 0);
          setPresentActive(data.presence.activeCount || 0);
          setPresentAway(data.presence.awayCount || 0);
        }

        const cur = data.auction.currentPrice || data.auction.startPrice;
        const nextMin = cur + data.auction.minIncrement;
        setBidAmount(nextMin);
        setAutoBidMax(nextMin + data.auction.minIncrement * 3);
      }
    } catch {
      onShowToast('error', 'Fetch Error', 'Failed to load auction details');
    }
  };

  // Fetch complete accepted bids history
  const fetchBids = async (page = bidsPage, bidderId = filterBidderId) => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      let url = `/api/auctions/${auctionId}/bids?page=${page}&limit=${bidsLimit}`;
      if (bidderId) url += `&bidderId=${encodeURIComponent(bidderId)}`;

      const res = await fetch(url, { headers });
      const data = await res.json();
      if (data.ok) {
        setBids(data.bids || []);
        setBidsTotal(data.total || 0);
        if (data.participants) setParticipants(data.participants);
        if (typeof data.uniqueParticipantsCount === 'number') setUniqueCount(data.uniqueParticipantsCount);
        if (typeof data.totalBidsCount === 'number') setTotalBidsCount(data.totalBidsCount);
        if (typeof data.currentHighestBid === 'number') setCurrentHighestBid(data.currentHighestBid);
      }
    } catch {}
  };

  const fetchQuestions = async () => {
    try {
      const res = await fetch(`/api/questions?auctionId=${auctionId}`);
      const data = await res.json();
      if (data.ok) setQuestions(data.questions || []);
    } catch {}
  };

  // Live polling for auction details, bids & Q&A every 2.5s
  useEffect(() => {
    fetchDetails();
    fetchBids(bidsPage, filterBidderId);
    fetchQuestions();
    const interval = setInterval(() => {
      fetchDetails();
      fetchBids(bidsPage, filterBidderId);
      fetchQuestions();
    }, 2500);
    return () => clearInterval(interval);
  }, [auctionId, token, bidsPage, filterBidderId]);

  // Real-time instant SSE listener with Live Presence, questions, answers, and bids with reconnect recovery
  useEffect(() => {
    const sseUrl = `/api/events?auctionId=${encodeURIComponent(auctionId)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
    const es = new EventSource(sseUrl);
    es.onopen = () => {
      // On reconnect or initial connection, refetch authoritative state
      fetchDetails();
      fetchBids(bidsPage, filterBidderId);
      fetchQuestions();
    };
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'PRESENCE_UPDATE' && event.auctionId === auctionId) {
          setPresenceUsers(event.users || []);
          setPresentTotal(event.totalPresent || 0);
          setPresentActive(event.activeCount || 0);
          setPresentAway(event.awayCount || 0);
        } else if (
          event.auctionId === auctionId ||
          event.type === 'BID_PLACED' ||
          event.type === 'OUTBID' ||
          event.type === 'DEADLINE_EXTENDED' ||
          event.type === 'AUTO_BID_TRIGGERED' ||
          event.type === 'AUCTION_MAX_REACHED'
        ) {
          fetchDetails();
          fetchBids(bidsPage, filterBidderId);
        } else if (
          event.type === 'QUESTION_ASKED' ||
          event.type === 'QUESTION_ANSWERED'
        ) {
          fetchQuestions();
        }
      } catch {}
    };
    return () => es.close();
  }, [auctionId, token, bidsPage, filterBidderId]);

  // Page Visibility API - background tab tracking (reports active tab vs away)
  useEffect(() => {
    if (!token || !auctionId) return;

    const reportVisibility = () => {
      const isVisible = document.visibilityState === 'visible';
      fetch('/api/presence/visibility', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          auctionId,
          visible: isVisible,
        }),
      }).catch(() => {});
    };

    document.addEventListener('visibilitychange', reportVisibility);
    return () => {
      document.removeEventListener('visibilitychange', reportVisibility);
    };
  }, [auctionId, token]);

  // Click outside listener for participant popovers
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.participant-avatar-wrapper')) {
        setActivePopoverId(null);
      }
    };
    if (activePopoverId) {
      document.addEventListener('mousedown', handleOutsideClick);
      return () => document.removeEventListener('mousedown', handleOutsideClick);
    }
  }, [activePopoverId]);

  // Countdown timer
  useEffect(() => {
    if (!auction?.closesAt) return;

    const updateTimer = () => {
      const diff = new Date(auction.closesAt).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft({ m: 0, s: 0, formatted: 'Closed' });
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / 1000 / 60) % 60);
      const seconds = Math.floor((diff / 1000) % 60);

      let str = '';
      if (days > 0) str = `${days}d ${hours}h`;
      else if (hours > 0) str = `${hours}h ${minutes}m`;
      else str = `${minutes}m ${seconds}s`;

      setTimeLeft({ m: minutes, s: seconds, formatted: str });
    };

    updateTimer();
    const t = setInterval(updateTimer, 1000);
    return () => clearInterval(t);
  }, [auction?.closesAt]);

  if (!auction) {
    return (
      <div className="app-body-container" style={{ textAlign: 'center', padding: '4rem' }}>
        <p style={{ color: '#64748b', fontSize: '1.1rem' }}>Loading auction details...</p>
      </div>
    );
  }

  const curPrice = auction.currentPrice || auction.startPrice;
  const minValidBid = curPrice + auction.minIncrement;
  const isLeader = auction.leaderId && auction.leaderId === user.id;
  const isSeller = user.role === 'seller';
  const isClosed = auction.status !== 'active';

  const images = auction.images && auction.images.length > 0
    ? auction.images
    : ['https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=800&q=80'];

  // Quick increment chip
  const handleQuickChip = (increment: number) => {
    setBidAmount(curPrice + increment);
  };

  // Place Bid action
  const handlePlaceBidSubmit = async () => {
    if (user.role === 'seller') {
      onShowToast('error', 'Seller Restricted', 'Sellers cannot place bids on any auction');
      return;
    }
    if (bidAmount < minValidBid) {
      onShowToast('warning', 'Invalid Bid', `Minimum valid bid is ₹${minValidBid}`);
      return;
    }

    setBidding(true);
    setShowConfirmModal(false);

    try {
      const res = await fetch('/api/bids', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Idempotency-Key': `bid-${auction._id}-${user.id}-${Date.now()}`,
        },
        body: JSON.stringify({
          auctionId: auction._id,
          amount: bidAmount,
        }),
      });
      const data = await res.json();

      if (res.ok && data.ok) {
        onShowToast('success', 'Bid Placed! 🎉', `You are now the highest bidder at ₹${bidAmount}`);
        fetchDetails();
        fetchBids(1, filterBidderId);
      } else {
        onShowToast('error', 'Bid Rejected', data.error || data.reason || 'Failed to place bid');
      }
    } catch {
      onShowToast('error', 'Network Error', 'Could not reach bidding server');
    } finally {
      setBidding(false);
    }
  };

  // Auto-bid proxy setup
  const handleSaveAutoBid = async () => {
    if (autoBidMax < minValidBid) {
      onShowToast('warning', 'Invalid Limit', `Auto-bid maximum must be at least ₹${minValidBid}`);
      return;
    }
    try {
      const res = await fetch('/api/auto-bids', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          auctionId: auction._id,
          maxAmount: autoBidMax,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        onShowToast('success', 'Auto-Bid Configured! 🤖', `Proxy will bid up to ₹${autoBidMax} to keep you leading`);
        setShowAutoBid(false);
        fetchDetails();
        fetchBids(1, filterBidderId);
      } else {
        onShowToast('error', 'Error', data.error || 'Failed to set auto-bid');
      }
    } catch {
      onShowToast('error', 'Network Error', 'Could not reach server');
    }
  };

  // Participant avatar click filters the live bid history to that student's bids
  const handleParticipantClick = (participantId: string) => {
    setActivePopoverId(prev => (prev === participantId ? null : participantId));
    setFilterBidderId(prev => {
      const next = prev === participantId ? null : participantId;
      setBidsPage(1);
      fetchBids(1, next);
      return next;
    });
  };

  const handleClearFilter = () => {
    setFilterBidderId(null);
    setActivePopoverId(null);
    setBidsPage(1);
    fetchBids(1, null);
  };

  const totalPages = Math.ceil(bidsTotal / bidsLimit) || 1;
  const handlePrevPage = () => {
    if (bidsPage > 1) {
      const next = bidsPage - 1;
      setBidsPage(next);
      fetchBids(next, filterBidderId);
    }
  };
  const handleNextPage = () => {
    if (bidsPage < totalPages) {
      const next = bidsPage + 1;
      setBidsPage(next);
      fetchBids(next, filterBidderId);
    }
  };

  // Q&A Question text duplicate check
  const handleQuestionInput = (text: string) => {
    setNewQuestionText(text);
    if (text.length > 3) {
      const match = questions.find((q) => q.text.toLowerCase().includes(text.toLowerCase().trim()));
      setSimilarQuestion(match ? match.text : null);
    } else {
      setSimilarQuestion(null);
    }
  };

  const handleAskQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuestionText.trim()) return;

    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          auctionId: auction._id,
          text: newQuestionText.trim(),
        }),
      });
      await res.json();
      if (res.ok) {
        onShowToast('success', 'Question Submitted', 'The seller has been notified');
        setNewQuestionText('');
        fetchQuestions();
      }
    } catch {
      onShowToast('error', 'Error', 'Failed to submit question');
    }
  };

  const handleAnswerQuestion = async (qId: string) => {
    if (!answerText.trim()) return;
    try {
      const res = await fetch(`/api/seller/questions/${qId}/answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ answer: answerText.trim() }),
      });
      if (res.ok) {
        onShowToast('success', 'Answer Submitted', 'Your reply is now visible on the auction page');
        setAnsweringQId(null);
        setAnswerText('');
        fetchQuestions();
      }
    } catch {
      onShowToast('error', 'Error', 'Failed to submit answer');
    }
  };

  return (
    <div className="app-body-container">
      {/* Breadcrumb Navigation */}
      <div className="breadcrumb-nav">
        <span className="clickable" onClick={onBackToListings}>Listings</span>
        <span>&gt;</span>
        <span className="clickable" onClick={onBackToListings}>{auction.category}</span>
        <span>&gt;</span>
        <span style={{ color: '#0f172a', fontWeight: 600 }}>{auction.title}</span>
      </div>

      {/* 2-Column Detail Layout */}
      <div className="auction-detail-layout">
        {/* Left Column: Gallery & Details */}
        <div>
          {/* Main Photo */}
          <div className="detail-gallery-main">
            <img src={images[activeImageIdx] || images[0]} alt={auction.title} />
          </div>

          {/* 4 Thumbnails Carousel underneath */}
          <div className="detail-thumbnails-row">
            {images.slice(0, 4).map((imgUrl, i) => (
              <div
                key={i}
                className={`detail-thumb-item ${activeImageIdx === i ? 'active' : ''}`}
                onClick={() => setActiveImageIdx(i)}
              >
                <img src={imgUrl} alt={`Thumbnail ${i + 1}`} />
              </div>
            ))}
          </div>

          {/* Item Metadata Card */}
          <div className="detail-meta-card">
            <div>
              <div className="meta-col-label">Item Condition</div>
              <div className="meta-col-val">{auction.condition || 'Good Condition'}</div>
            </div>
            <div style={{ borderLeft: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0', padding: '0 1.5rem' }}>
              <div className="meta-col-label">Category</div>
              <div className="meta-col-val">{auction.category}</div>
            </div>
            <div>
              <div className="meta-col-label">Posted On</div>
              <div className="meta-col-val">Oct 25, 2026</div>
            </div>
          </div>
        </div>

        {/* Right Column: Title, Seller, Metrics & Bidding */}
        <div>
          {/* Header & Favorite */}
          <div className="detail-info-header">
            <h1 className="detail-title">{auction.title}</h1>
            <button
              className="detail-fav-btn"
              onClick={() => setIsFavorite(!isFavorite)}
              title="Add to Watchlist"
            >
              {isFavorite ? '❤️' : '🤍'}
            </button>
          </div>

          {/* Seller Card */}
          <div className="detail-seller-card">
            <div className="detail-seller-avatar">
              {seller ? seller.name[0] : 'R'}
            </div>
            <div>
              <div className="detail-seller-name">{seller ? seller.name : 'Rahul S.'}</div>
              <div className="detail-seller-sub">{seller ? seller.yearBranch : '3rd Year - CSE'}</div>
            </div>
            <div className="verified-badge">
              <span>✓</span> Verified Student
            </div>
          </div>

          {/* Description */}
          <p className="detail-description">{auction.description}</p>

          {/* 4-Column Auction Metrics Card */}
          <div className="detail-metrics-card">
            <div>
              <div className="metric-col-title">Current Price</div>
              <div className="metric-col-val price">₹{curPrice.toLocaleString()}</div>
              <div className={`metric-subtext ${isLeader ? 'leading' : ''}`}>
                {isLeader ? '✓ You are leading' : 'Not the current leader'}
              </div>
            </div>

            <div>
              <div className="metric-col-title">Bids</div>
              <div className="metric-col-val">{auction.bidCount}</div>
              <div className="metric-subtext">{auction.bidCount} total placed</div>
            </div>

            <div>
              <div className="metric-col-title">Min Increment</div>
              <div className="metric-col-val">₹{auction.minIncrement}</div>
              <div className="metric-subtext">Per step</div>
            </div>

            <div>
              <div className="metric-col-title">Time Remaining</div>
              <div className="metric-col-val timer">⏱ {timeLeft.formatted}</div>
              <div className="metric-subtext">Live countdown</div>
            </div>
          </div>

          {/* ============================================================
              IMAGE 2 FEATURE: LIVE BID PARTICIPANTS COMPONENT
              (With Live Room Presence Integrated Directly Into Participants)
              ============================================================ */}
          <div className="live-participants-card">
            <div className="live-participants-header">
              <div>
                <div className="live-participants-title">Live Bid Participants</div>
                <div className="live-participants-subtitle">
                  {auction.title} · {auction.category}
                </div>
              </div>
              <div
                className="live-badge-pill"
                title={`${presentTotal} student${presentTotal === 1 ? '' : 's'} viewing this page now (${presentActive} active${
                  presentAway > 0 ? `, ${presentAway} away` : ''
                })`}
              >
                <span className="live-dot-pulse" />
                <span>LIVE · {presentTotal > 0 ? `${presentTotal} IN ROOM` : 'LIVE'}</span>
              </div>
            </div>

            {/* Circular Avatars Row */}
            <div className="participants-avatars-row">
              {unifiedParticipants.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: '0.85rem', padding: '0.75rem 0' }}>
                  No bids placed yet. Place the opening bid to be the first participant!
                </div>
              ) : (
                <>
                  {unifiedParticipants.slice(0, 8).map((p) => {
                    const isSelected = filterBidderId === p.id;
                    const isPopoverOpen = activePopoverId === p.id;

                    return (
                      <div
                        key={p.id}
                        className={`participant-avatar-wrapper ${isSelected ? 'active-filter' : ''}`}
                        onClick={() => {
                          if (p.isBidder) {
                            handleParticipantClick(p.id);
                          } else {
                            setActivePopoverId(isPopoverOpen ? null : p.id);
                          }
                        }}
                        title={`${p.name} ${p.isYou ? '(You)' : ''}${
                          p.isBidder ? ' · Click to filter bids' : ' · Spectating'
                        }`}
                      >
                        <div
                          className={`participant-avatar-circle ${p.colorClass} ${
                            p.status === 'leading' ? 'is-leader-ring' : p.isOnline ? 'is-online' : ''
                          } ${p.isOnline && !p.isVisible ? 'is-away' : ''} ${
                            !p.isBidder ? 'is-spectator' : ''
                          }`}
                        >
                          {p.initials}

                          {/* Real-time Presence Indicator Dot on Avatar */}
                          {p.isOnline && (
                            <span
                              className={`participant-presence-dot ${
                                !p.isVisible ? 'away' : p.status === 'leading' ? 'leader' : ''
                              }`}
                              title={
                                p.status === 'leading'
                                  ? 'Leading Bidder (In Room)'
                                  : p.isVisible
                                  ? 'Active in room right now'
                                  : 'Away in background tab'
                              }
                            />
                          )}
                        </div>

                        <div className="participant-avatar-label">
                          {p.isYou ? 'You' : p.name.split(' ')[0]}
                        </div>

                        {/* Popover on click */}
                        {isPopoverOpen && (
                          <div className="participant-popover" onClick={(e) => e.stopPropagation()}>
                            <div className="popover-arrow" />
                            <div className="popover-name">
                              {p.name} {p.isYou ? '(You)' : ''}
                            </div>
                            <div className="popover-branch">{p.yearBranch}</div>

                            {p.isBidder ? (
                              <div className="popover-bid-row">
                                <span style={{ color: '#cbd5e1' }}>
                                  Highest: ₹{p.highestBid.toLocaleString()}
                                </span>
                                <span className={`popover-status-badge ${p.status}`}>
                                  {p.status === 'leading' ? 'Leading' : 'Outbid'}
                                </span>
                              </div>
                            ) : (
                              <div style={{ margin: '0.35rem 0', fontSize: '0.78rem', color: '#38bdf8' }}>
                                👀 Spectating in room
                              </div>
                            )}

                            {/* Room Presence Status */}
                            <div
                              style={{
                                marginTop: '0.45rem',
                                paddingTop: '0.35rem',
                                borderTop: '1px solid rgba(255,255,255,0.08)',
                                fontSize: '0.72rem',
                                color: p.isVisible ? '#34d399' : '#f59e0b',
                                textAlign: 'center',
                              }}
                            >
                              {p.isVisible
                                ? '🟢 In the room right now (Active)'
                                : '🌙 In the room (Away in background)'}
                            </div>

                            {p.isBidder && (
                              <div
                                style={{
                                  marginTop: '0.3rem',
                                  fontSize: '0.7rem',
                                  color: '#94a3b8',
                                  textAlign: 'center',
                                }}
                              >
                                {p.bidCount || 1} bids placed · Click to {isSelected ? 'clear filter' : 'filter'}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {unifiedParticipants.length > 8 && (
                    <div
                      className="participant-avatar-wrapper"
                      onClick={() =>
                        onShowToast(
                          'info',
                          'Active Participants',
                          `${uniqueCount} registered students have placed bids · ${presentTotal} viewing live.`
                        )
                      }
                      title={`${unifiedParticipants.length - 8} more students`}
                    >
                      <div className="participant-avatar-circle avatar-more">
                        +{unifiedParticipants.length - 8}
                      </div>
                      <div className="participant-avatar-label">More</div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Divider line */}
            <div className="live-participants-divider" />

            {/* Footer Summary with separate Unique Participants and Total Bids */}
            <div className="live-participants-footer">
              <div className="participants-count-block">
                <div className="count-label">Unique participants</div>
                <div className="count-val">{uniqueCount} students</div>
              </div>

              <div className="participants-count-block" style={{ textAlign: 'center' }}>
                <div className="count-label">Total bids placed</div>
                <div className="count-val">{totalBidsCount} bids</div>
              </div>

              <div className="highest-bid-block">
                <div className="highest-label">Current highest bid</div>
                <div className="highest-val">₹{currentHighestBid.toLocaleString()}</div>
              </div>
            </div>
          </div>

          {/* Bidding Console (Buyer Only) */}
          {!isSeller && !isClosed ? (
            <div className="detail-bid-box">
              <div className="bid-box-title">Place a Bid</div>

              {/* Quick Increment Chips */}
              <div className="quick-chips-row">
                <button
                  type="button"
                  className="quick-chip-btn"
                  onClick={() => handleQuickChip(50)}
                >
                  + ₹50
                </button>
                <button
                  type="button"
                  className="quick-chip-btn"
                  onClick={() => handleQuickChip(100)}
                >
                  + ₹100
                </button>
                <button
                  type="button"
                  className="quick-chip-btn"
                  onClick={() => handleQuickChip(250)}
                >
                  + ₹250
                </button>
                <button
                  type="button"
                  className="quick-chip-btn"
                  onClick={() => handleQuickChip(500)}
                >
                  + ₹500
                </button>
              </div>

              {/* Bid Amount Input */}
              <div className="bid-input-row">
                <span className="bid-currency-symbol">₹</span>
                <input
                  type="number"
                  className="bid-input-amount"
                  placeholder={`Enter amount (min ₹${minValidBid})`}
                  value={bidAmount}
                  onChange={(e) => setBidAmount(Number(e.target.value))}
                />
              </div>

              {/* Main Emerald Green Button */}
              <button
                type="button"
                className="btn-place-bid"
                disabled={bidding || bidAmount < minValidBid}
                onClick={() => setShowConfirmModal(true)}
              >
                🔨 Place Bid
              </button>

              <div className="bid-disclaimer">
                You will be asked to confirm before placing the bid.
              </div>

              {/* Auto-bid toggle */}
              <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '0.82rem', cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => setShowAutoBid(!showAutoBid)}
                >
                  {showAutoBid ? '▲ Hide Auto-Bid Proxy' : '🤖 Set Auto-Bid Proxy Limit'}
                </button>
              </div>

              {showAutoBid && (
                <div style={{ marginTop: '0.85rem', padding: '1rem', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                    Auto-Bid Proxy (Maximum Willingness to Pay)
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.65rem' }}>
                    We'll bid only as much as needed to keep you ahead, up to your ceiling.
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="number"
                      className="input-field"
                      style={{ height: '40px' }}
                      value={autoBidMax}
                      onChange={(e) => setAutoBidMax(Number(e.target.value))}
                    />
                    <button
                      type="button"
                      className="btn-primary-dark"
                      style={{ height: '40px', width: 'auto', padding: '0 1rem' }}
                      onClick={handleSaveAutoBid}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : isSeller ? (
            <div style={{ padding: '1rem', background: '#fef3c7', borderRadius: '10px', color: '#92400e', fontSize: '0.88rem', marginBottom: '1.5rem' }}>
              ℹ️ <strong>Seller Mode:</strong> As a registered seller, bidding is disabled for you. You can review buyer offers, track countdowns, and answer questions.
            </div>
          ) : (
            <div style={{ padding: '1rem', background: '#f1f5f9', borderRadius: '10px', color: '#64748b', fontSize: '0.88rem', marginBottom: '1.5rem' }}>
              🔒 <strong>Auction Closed:</strong> Bidding for this listing has concluded.
            </div>
          )}

          {/* ============================================================
              LIVE BID HISTORY SECTION
              ============================================================ */}
          <div className="bid-history-card">
            <div className="bid-history-header">
              <div className="bid-history-title-group">
                <h3 className="bid-history-title">Live Bid History</h3>
                <span className="bid-history-count-badge">
                  {bidsTotal} {bidsTotal === 1 ? 'accepted bid' : 'accepted bids'}
                </span>
                <div className="live-badge-pill" style={{ padding: '0.1rem 0.45rem', fontSize: '0.65rem' }}>
                  <span className="live-dot-pulse" />
                  <span>SYNCED</span>
                </div>
              </div>

              {filterBidderId && (
                <div className="bid-filter-indicator">
                  <span>
                    Filtered by{' '}
                    <strong>
                      {participants.find((p) => p.id === filterBidderId)?.name || 'Selected Bidder'}
                    </strong>
                  </span>
                  <button
                    className="bid-filter-clear-btn"
                    onClick={handleClearFilter}
                    title="View all bids"
                  >
                    Clear Filter
                  </button>
                </div>
              )}
            </div>

            {/* Bids Table or Empty State */}
            {bids.length === 0 ? (
              <div className="bid-history-empty">
                <div className="bid-history-empty-icon">🏷️</div>
                <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>
                  {filterBidderId ? 'No bids found for this student.' : 'No bids placed yet.'}
                </div>
                <div style={{ fontSize: '0.82rem', color: '#64748b' }}>
                  {filterBidderId ? (
                    <button className="bid-filter-clear-btn" onClick={handleClearFilter}>
                      Reset filter to see all bids
                    </button>
                  ) : (
                    'Place the opening bid above to take the lead!'
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="bid-history-table-container">
                  <table className="bid-history-table">
                    <thead>
                      <tr>
                        <th>Bidder</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Type</th>
                        <th style={{ textAlign: 'right' }}>Placed At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bids.map((b, idx) => {
                        const avatarClass = b.isYou ? 'avatar-color-0' : `avatar-color-${(idx + 1) % 7}`;
                        return (
                          <tr
                            key={b._id}
                            className={`bid-history-row ${b.isLeading ? 'leading-row' : ''}`}
                          >
                            <td>
                              <div className="bidder-info-cell">
                                <div className={`bidder-avatar-sm ${avatarClass}`}>
                                  {b.bidderInitials}
                                </div>
                                <div className="bidder-name-group">
                                  <div className="bidder-name-text">
                                    <span>{b.bidderName}</span>
                                    {b.isLeading && (
                                      <span style={{ fontSize: '0.7rem', color: '#059669', fontWeight: 700 }}>
                                        ★
                                      </span>
                                    )}
                                  </div>
                                  <div className="bidder-subtext">{b.bidderYearBranch || 'Campus Student'}</div>
                                </div>
                              </div>
                            </td>
                            <td>
                              <div className={`bid-amount-text ${b.isLeading ? 'leading' : ''}`}>
                                ₹{b.amount.toLocaleString()}
                              </div>
                            </td>
                            <td>
                              {b.isLeading ? (
                                <span className="bid-badge leading">
                                  <span>✓</span> Leading
                                </span>
                              ) : (
                                <span className="bid-badge outbid">
                                  Outbid
                                </span>
                              )}
                            </td>
                            <td>
                              {b.source === 'auto' ? (
                                <span className="bid-badge auto" title="Placed automatically via Auto-Bid Proxy">
                                  ⚡ Auto-bid
                                </span>
                              ) : (
                                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Manual</span>
                              )}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <span className="bid-time-text" title={new Date(b.createdAt || b.serverTs).toLocaleString()}>
                                {formatBidTimestamp(b.createdAt || b.serverTs)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                {bidsTotal > bidsLimit && (
                  <div className="bid-history-pagination">
                    <div className="bid-pagination-info">
                      Showing {(bidsPage - 1) * bidsLimit + 1}–
                      {Math.min(bidsPage * bidsLimit, bidsTotal)} of {bidsTotal} bids
                    </div>
                    <div className="bid-pagination-actions">
                      <button
                        className="bid-page-btn"
                        onClick={handlePrevPage}
                        disabled={bidsPage <= 1}
                      >
                        ← Previous
                      </button>
                      <button
                        className="bid-page-btn"
                        onClick={handleNextPage}
                        disabled={bidsPage >= totalPages}
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Q&A Section */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '1.25rem', marginTop: '1.5rem' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '0.85rem' }}>Questions & Answers</h3>

            {/* Existing Questions */}
            {questions.length === 0 ? (
              <p style={{ fontSize: '0.82rem', color: '#94a3b8', marginBottom: '1rem' }}>
                No questions asked yet. Have an inquiry about condition, pickup, or accessories?
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '1.25rem' }}>
                {questions.map((q) => (
                  <div key={q._id} style={{ padding: '0.75rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0f172a' }}>
                      Q: {q.text}
                    </div>
                    {q.answer ? (
                      <div style={{ fontSize: '0.82rem', color: '#059669', marginTop: '0.35rem', background: '#ecfdf5', padding: '0.45rem', borderRadius: '6px' }}>
                        <strong>A:</strong> {q.answer}
                      </div>
                    ) : isSeller ? (
                      answeringQId === q._id ? (
                        <div style={{ marginTop: '0.5rem' }}>
                          <input
                            type="text"
                            className="input-field"
                            placeholder="Type your reply..."
                            value={answerText}
                            onChange={(e) => setAnswerText(e.target.value)}
                            style={{ height: '36px', marginBottom: '0.4rem' }}
                          />
                          <button className="btn-primary-dark" style={{ height: '34px' }} onClick={() => handleAnswerQuestion(q._id)}>
                            Submit Answer
                          </button>
                        </div>
                      ) : (
                        <button
                          style={{ marginTop: '0.4rem', background: 'none', border: 'none', color: '#0f172a', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer' }}
                          onClick={() => setAnsweringQId(q._id)}
                        >
                          💬 Answer this question
                        </button>
                      )
                    ) : (
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                        Awaiting seller response
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Ask Question Form */}
            {!isSeller && (
              <form onSubmit={handleAskQuestion}>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Ask seller a question about this item..."
                    value={newQuestionText}
                    onChange={(e) => handleQuestionInput(e.target.value)}
                  />
                </div>
                {similarQuestion && (
                  <div style={{ fontSize: '0.75rem', color: '#b45309', background: '#fef3c7', padding: '0.4rem 0.6rem', borderRadius: '6px', marginTop: '0.4rem' }}>
                    ⚠️ Similar question found: "{similarQuestion}"
                  </div>
                )}
                <button
                  type="submit"
                  className="btn-primary-dark"
                  style={{ marginTop: '0.5rem', height: '40px' }}
                  disabled={!newQuestionText.trim()}
                >
                  Submit Question
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="modal-overlay" onClick={() => setShowConfirmModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Confirm Your Bid</h3>
              <button className="modal-close-btn" onClick={() => setShowConfirmModal(false)}>×</button>
            </div>
            <p style={{ fontSize: '0.92rem', color: '#475569', marginBottom: '1.25rem' }}>
              You are about to place a binding bid of <strong>₹{bidAmount.toLocaleString()}</strong> on:
              <br />
              <strong style={{ color: '#0f172a' }}>{auction.title}</strong>
              <br /><br />
              If you win, you agree to coordinate campus pickup with the seller.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                className="btn-primary-dark"
                style={{ background: '#10b981' }}
                onClick={handlePlaceBidSubmit}
              >
                Confirm ₹{bidAmount.toLocaleString()} Bid
              </button>
              <button
                className="btn-primary-dark"
                style={{ background: '#f1f5f9', color: '#0f172a' }}
                onClick={() => setShowConfirmModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
