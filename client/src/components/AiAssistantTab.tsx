import React, { useState, useEffect, useRef } from 'react';
import type {
  AssistantChatMessage,
  WatchItem,
} from '../types';

interface AiAssistantTabProps {
  token: string;
  onSelectAuction?: (auctionId: string) => void;
  showToast: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
}

export const AiAssistantTab: React.FC<AiAssistantTabProps> = ({
  token,
  onSelectAuction,
  showToast,
}) => {
  // Chat state
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Watches ("Never Miss What You Need") state
  const [watches, setWatches] = useState<WatchItem[]>([]);
  const [loadingWatches, setLoadingWatches] = useState(false);
  const [watchKeywords, setWatchKeywords] = useState('');
  const [watchCategory, setWatchCategory] = useState('');
  const [watchMaxPrice, setWatchMaxPrice] = useState('');
  const [savingWatch, setSavingWatch] = useState(false);

  // Browser Push permission status
  const [browserPushStatus, setBrowserPushStatus] = useState<NotificationPermission>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'default';
  });

  // Auto-scroll chat to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  // Load chat history & watches on mount
  useEffect(() => {
    fetchHistory();
    fetchWatches();
  }, [token]);

  const fetchHistory = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/assistant/history', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.messages) && data.messages.length > 0) {
        setMessages(
          data.messages.map((m: any) => ({
            id: m._id || String(Date.now()),
            sender: m.role === 'assistant' ? 'assistant' : 'user',
            text: m.content || '',
            proposals: m.proposals || [],
            listingCards: m.listingCards || [],
          }))
        );
      } else {
        // Default warm welcome
        setMessages([
          {
            id: 'welcome-1',
            sender: 'assistant',
            text: "👋 Hi! I'm your CampusBid AI Assistant. Ask me to find deals on campus, compare items, or prepare a smart auto-bid. I will never place bids without your explicit approval!",
          },
        ]);
      }
    } catch {
      // Fallback greeting
      setMessages([
        {
          id: 'welcome-1',
          sender: 'assistant',
          text: "👋 Hi! I'm your CampusBid AI Assistant. Ask me to find deals or prepare an auto-bid proposal for you.",
        },
      ]);
    }
  };

  const fetchWatches = async () => {
    if (!token) return;
    setLoadingWatches(true);
    try {
      const res = await fetch('/api/watches', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setWatches(data.watches || []);
      }
    } catch (err: any) {
      console.error('Failed to load watches:', err);
    } finally {
      setLoadingWatches(false);
    }
  };

  // Send message to Gemini Assistant
  const handleSend = async (e?: React.FormEvent, customText?: string) => {
    if (e) e.preventDefault();
    const textToSend = (customText !== undefined ? customText : input).trim();
    if (!textToSend || loading) return;

    if (customText === undefined) {
      setInput('');
    }

    const userMsg: AssistantChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: textToSend,
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: textToSend }),
      });

      const data = await res.json();

      const assistantMsg: AssistantChatMessage = {
        id: `ast-${Date.now()}`,
        sender: 'assistant',
        text: data.reply || (data.ok ? "Here's what I found." : data.error || 'Assistant unavailable.'),
        proposals: data.proposals || [],
        listingCards: data.listingCards || [],
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // If a watch proposal was prepared, refresh watches list in case it's related
      if (data.proposals && data.proposals.some((p: any) => p.type === 'watch')) {
        fetchWatches();
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `ast-${Date.now()}`,
          sender: 'assistant',
          text: "I'm having trouble reaching Gemini right now. You can still browse active listings or configure alerts directly on the right.",
        },
      ]);
      showToast('error', 'Connection Error', err.message || 'Could not reach server.');
    } finally {
      setLoading(false);
    }
  };

  // Approve a proposal (Auto-bid or Watch)
  const handleApproveProposal = async (proposalId: string) => {
    setActionInProgress(proposalId);
    try {
      const res = await fetch(`/api/assistant/proposals/${proposalId}/approve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (data.ok) {
        showToast('success', 'Action Approved', data.message || 'Proposal executed successfully.');
        // Update local status of proposal in message list
        setMessages((prev) =>
          prev.map((msg) => {
            if (!msg.proposals) return msg;
            return {
              ...msg,
              proposals: msg.proposals.map((p) =>
                p._id === proposalId ? { ...p, status: 'approved' } : p
              ),
            };
          })
        );
        fetchWatches();
      } else {
        showToast('error', 'Approval Failed', data.error || 'Could not approve proposal.');
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    } finally {
      setActionInProgress(null);
    }
  };

  // Dismiss a proposal
  const handleDismissProposal = async (proposalId: string) => {
    setActionInProgress(proposalId);
    try {
      const res = await fetch(`/api/assistant/proposals/${proposalId}/dismiss`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (data.ok) {
        showToast('info', 'Dismissed', 'Proposal was dismissed.');
        setMessages((prev) =>
          prev.map((msg) => {
            if (!msg.proposals) return msg;
            return {
              ...msg,
              proposals: msg.proposals.map((p) =>
                p._id === proposalId ? { ...p, status: 'dismissed' } : p
              ),
            };
          })
        );
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    } finally {
      setActionInProgress(null);
    }
  };

  // Create Watch manually via "Notify Me" form
  const handleCreateWatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!watchKeywords.trim() && !watchCategory) {
      showToast('warning', 'Missing Details', 'Please provide keywords or select a category.');
      return;
    }

    setSavingWatch(true);
    try {
      const res = await fetch('/api/watches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          keywords: watchKeywords,
          category: watchCategory || undefined,
          maxPrice: watchMaxPrice ? Number(watchMaxPrice) : undefined,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        showToast('success', 'Alert Created', 'You will be notified when matching listings are published!');
        setWatchKeywords('');
        setWatchCategory('');
        setWatchMaxPrice('');
        fetchWatches();
      } else {
        showToast('error', 'Failed', data.error || 'Could not create alert.');
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    } finally {
      setSavingWatch(false);
    }
  };

  // Toggle watch active / pause
  const handleToggleWatch = async (watchId: string) => {
    try {
      const res = await fetch(`/api/watches/${watchId}/toggle`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setWatches((prev) =>
          prev.map((w) => (w._id === watchId ? { ...w, active: data.data.active } : w))
        );
        showToast(
          'info',
          data.data.active ? 'Alert Resumed' : 'Alert Paused',
          data.data.active
            ? 'You will receive notifications for this item.'
            : 'Alert is paused.'
        );
      } else {
        showToast('error', 'Error', data.error || 'Failed to toggle alert.');
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    }
  };

  // Delete watch
  const handleDeleteWatch = async (watchId: string) => {
    try {
      const res = await fetch(`/api/watches/${watchId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setWatches((prev) => prev.filter((w) => w._id !== watchId));
        showToast('info', 'Deleted', 'Alert watch removed.');
      } else {
        showToast('error', 'Error', data.error || 'Could not delete alert.');
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    }
  };

  // Request browser desktop push permission
  const handleRequestPushPermission = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const perm = await Notification.requestPermission();
        setBrowserPushStatus(perm);
        if (perm === 'granted') {
          showToast('success', 'Alerts Enabled', 'Browser push notifications are now active!');
        } else {
          showToast('info', 'Permission Denied', 'Browser push notifications were blocked.');
        }
      } catch (err) {
        console.error(err);
      }
    }
  };

  const activeWatchesCount = watches.filter((w) => w.active).length;

  return (
    <div className="assistant-page-container">
      <div className="assistant-split-grid">
        {/* =========================================================
            LEFT COLUMN: AI CHAT WITH PROPOSALS & LISTING CARDS
            ========================================================= */}
        <section className="assistant-chat-panel">
          <div className="chat-panel-header">
            <div className="chat-header-title">
              <span className="chat-bot-avatar">🤖</span>
              <div>
                <h3>Assistant Chat</h3>
              </div>
            </div>
            <button
              className="btn-refresh-chat"
              title="Refresh conversation"
              onClick={fetchHistory}
            >
              🔄
            </button>
          </div>

          {/* Quick Prompts Bar */}
          <div className="quick-prompts-row">
            <button
              className="quick-prompt-chip"
              onClick={() => handleSend(undefined, 'Find laptops or electronics under ₹5,000')}
            >
              💻 Electronics under ₹5k
            </button>
            <button
              className="quick-prompt-chip"
              onClick={() => handleSend(undefined, 'Are there any bicycles available right now?')}
            >
              🚲 Bicycles
            </button>
            <button
              className="quick-prompt-chip"
              onClick={() => handleSend(undefined, 'Alert me when engineering textbooks or lab coats are listed')}
            >
              📚 Alert for books
            </button>
          </div>

          {/* Scrollable Message Thread */}
          <div className="chat-messages-thread">
            {messages.map((m) => (
              <div key={m.id || Math.random()} className={`chat-message-row ${m.sender}`}>
                <div className="chat-message-avatar">
                  {m.sender === 'assistant' ? '🤖' : '👤'}
                </div>

                <div className="chat-message-body">
                  <div className="chat-bubble-text">
                    <p>{m.text}</p>
                  </div>

                  {/* Render Listing Cards (if any were found) */}
                  {m.listingCards && m.listingCards.length > 0 && (
                    <div className="assistant-listing-cards-grid">
                      {m.listingCards.map((card) => (
                        <div key={card.id} className="assistant-mini-card">
                          <img
                            src={card.image}
                            alt={card.title}
                            className="mini-card-thumb"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src =
                                'https://images.unsplash.com/photo-1526738549149-8e07eca6c147?auto=format&fit=crop&w=600&q=80';
                            }}
                          />
                          <div className="mini-card-info">
                            <span className="mini-card-category">{card.category}</span>
                            <h5 className="mini-card-title" title={card.title}>
                              {card.title}
                            </h5>
                            <div className="mini-card-pricing">
                              <span className="mini-card-price">
                                ₹{(card.currentPrice || card.startPrice).toLocaleString()}
                              </span>
                              <span className="mini-card-time">{card.timeLeft}</span>
                            </div>
                            {onSelectAuction && (
                              <button
                                className="btn-mini-card-view"
                                onClick={() => onSelectAuction(card.id)}
                              >
                                View Auction →
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Render Proposals Confirmation Cards */}
                  {m.proposals && m.proposals.length > 0 && (
                    <div className="assistant-proposals-stack">
                      {m.proposals.map((proposal) => {
                        const isPending = proposal.status === 'pending';
                        const isApproved = proposal.status === 'approved';
                        const isDismissed = proposal.status === 'dismissed';
                        const isExpired = proposal.status === 'expired';

                        return (
                          <div
                            key={proposal._id}
                            className={`assistant-proposal-card ${proposal.status}`}
                          >
                            <div className="proposal-card-header">
                              <span className="proposal-type-pill">
                                {proposal.type === 'autobid' ? '⚡ Auto-Bid Proposal' : '🔔 Watch Alert Proposal'}
                              </span>
                              <span className={`proposal-status-badge ${proposal.status}`}>
                                {isPending && '⏳ Awaiting Approval'}
                                {isApproved && '✅ Approved & Active'}
                                {isDismissed && '✖ Dismissed'}
                                {isExpired && '⏱️ Expired'}
                              </span>
                            </div>

                            <div className="proposal-card-content">
                              <h4 className="proposal-summary-title">{proposal.summary}</h4>

                              {proposal.type === 'autobid' && (
                                <div className="proposal-meta-grid">
                                  <div className="meta-item">
                                    <span className="meta-label">Item</span>
                                    <span className="meta-val">{proposal.parameters.itemTitle}</span>
                                  </div>
                                  <div className="meta-item">
                                    <span className="meta-label">Current Price</span>
                                    <span className="meta-val">
                                      ₹{(proposal.parameters.currentPrice || 0).toLocaleString()}
                                    </span>
                                  </div>
                                  <div className="meta-item highlight">
                                    <span className="meta-label">Maximum Cap</span>
                                    <span className="meta-val">
                                      ₹{(proposal.parameters.maxAmount || 0).toLocaleString()}
                                    </span>
                                  </div>
                                </div>
                              )}

                              {proposal.type === 'watch' && (
                                <div className="proposal-meta-grid">
                                  <div className="meta-item">
                                    <span className="meta-label">Keywords</span>
                                    <span className="meta-val">
                                      {(proposal.parameters.keywords || []).join(', ')}
                                    </span>
                                  </div>
                                  {proposal.parameters.category && (
                                    <div className="meta-item">
                                      <span className="meta-label">Category</span>
                                      <span className="meta-val">{proposal.parameters.category}</span>
                                    </div>
                                  )}
                                  {proposal.parameters.maxPrice && (
                                    <div className="meta-item highlight">
                                      <span className="meta-label">Max Budget</span>
                                      <span className="meta-val">
                                        ₹{proposal.parameters.maxPrice.toLocaleString()}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Action Buttons for Pending Proposal */}
                            {isPending && (
                              <div className="proposal-actions-row">
                                <button
                                  className="btn-proposal-approve"
                                  disabled={actionInProgress === proposal._id}
                                  onClick={() => handleApproveProposal(proposal._id)}
                                >
                                  {actionInProgress === proposal._id ? 'Activating...' : '✓ Approve Action'}
                                </button>
                                <button
                                  className="btn-proposal-dismiss"
                                  disabled={actionInProgress === proposal._id}
                                  onClick={() => handleDismissProposal(proposal._id)}
                                >
                                  Dismiss
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="chat-message-row assistant">
                <div className="chat-message-avatar">🤖</div>
                <div className="chat-message-body">
                  <div className="chat-bubble-text loading-pulse">
                    <span className="loading-dot"></span>
                    <span className="loading-dot"></span>
                    <span className="loading-dot"></span>
                    <span style={{ marginLeft: '0.5rem', color: '#94a3b8', fontSize: '0.85rem' }}>
                      Gemini is searching campus catalog...
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input Bar */}
          <form onSubmit={handleSend} className="chat-input-container">
            <input
              type="text"
              className="chat-text-input"
              placeholder="Ask anything: 'Recommend electronics' or 'Auto-bid up to ₹2500 on item'..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              maxLength={500}
            />
            <button
              type="submit"
              className="btn-chat-send"
              disabled={loading || !input.trim()}
            >
              {loading ? 'Thinking...' : 'Send →'}
            </button>
          </form>
        </section>

        {/* =========================================================
            RIGHT COLUMN: "NEVER MISS WHAT YOU NEED" (WATCHES)
            ========================================================= */}
        <section className="assistant-watches-panel">
          <div className="watches-panel-header">
            <div>
              <h3>Never Miss What You Need</h3>
            </div>
            <span className="watches-count-badge">
              {activeWatchesCount} / 10 Active
            </span>
          </div>

          {/* Desktop Push Notification Permission Card */}
          <div className="push-permission-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '1.2rem' }}>🔔</span>
              <strong>Desktop & Background Alerts</strong>
            </div>
            {browserPushStatus !== 'granted' && (
              <button
                type="button"
                className="btn-enable-alerts"
                onClick={handleRequestPushPermission}
              >
                Enable Alerts
              </button>
            )}
            {browserPushStatus === 'granted' && (
              <span className="badge-granted">✓ Active</span>
            )}
          </div>

          {/* Manual "Notify Me" Form */}
          <div className="create-watch-box">
            <h4>+ Create New Watch Alert</h4>
            <form onSubmit={handleCreateWatch} className="watch-form-grid">
              <div className="form-field">
                <label>Keywords (comma separated)</label>
                <input
                  type="text"
                  placeholder="e.g. iPad, MacBook, bicycle, lab coat"
                  value={watchKeywords}
                  onChange={(e) => setWatchKeywords(e.target.value)}
                  className="watch-input"
                />
              </div>

              <div className="form-field-row">
                <div className="form-field">
                  <label>Category (optional)</label>
                  <select
                    value={watchCategory}
                    onChange={(e) => setWatchCategory(e.target.value)}
                    className="watch-select"
                  >
                    <option value="">Any Category</option>
                    <option value="Electronics">Electronics</option>
                    <option value="Bicycles">Bicycles</option>
                    <option value="Books">Books</option>
                    <option value="Furniture">Furniture</option>
                    <option value="Lab Equipment">Lab Equipment</option>
                    <option value="Sports">Sports</option>
                    <option value="Others">Others</option>
                  </select>
                </div>

                <div className="form-field">
                  <label>Max Budget in ₹ (optional)</label>
                  <input
                    type="number"
                    placeholder="e.g. 3500"
                    value={watchMaxPrice}
                    onChange={(e) => setWatchMaxPrice(e.target.value)}
                    className="watch-input"
                    min="1"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn-save-watch"
                disabled={savingWatch || (!watchKeywords.trim() && !watchCategory)}
              >
                {savingWatch ? 'Saving Alert...' : 'Save Watch Alert'}
              </button>
            </form>
          </div>

          {/* Saved Watches List */}
          <div className="saved-watches-section">
            <h4>My Active Watches</h4>

            {loadingWatches ? (
              <div className="watches-loading">Loading saved alerts...</div>
            ) : watches.length === 0 ? (
              <div className="watches-empty-card">
                <span>🔍</span>
                <p>No active watches yet. Create an alert above or ask the AI Assistant!</p>
              </div>
            ) : (
              <div className="watches-cards-list">
                {watches.map((w) => (
                  <div key={w._id} className={`watch-item-card ${w.active ? 'active' : 'paused'}`}>
                    <div className="watch-card-top">
                      <div className="watch-keywords-wrap">
                        {w.keywords.map((kw, idx) => (
                          <span key={idx} className="keyword-tag">
                            #{kw}
                          </span>
                        ))}
                        {w.category && <span className="category-pill">{w.category}</span>}
                        {w.maxPrice && (
                          <span className="price-cap-pill">≤ ₹{w.maxPrice.toLocaleString()}</span>
                        )}
                      </div>

                      <span className={`watch-active-pill ${w.active ? 'active' : 'paused'}`}>
                        {w.active ? 'Active' : 'Paused'}
                      </span>
                    </div>

                    {w.lastMatchedAt && (
                      <div className="watch-match-time">
                        ⚡ Last matched: {new Date(w.lastMatchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}

                    <div className="watch-card-actions">
                      <button
                        className="btn-watch-toggle"
                        onClick={() => handleToggleWatch(w._id)}
                      >
                        {w.active ? '⏸ Pause' : '▶ Resume'}
                      </button>
                      <button
                        className="btn-watch-delete"
                        onClick={() => handleDeleteWatch(w._id)}
                      >
                        🗑 Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
