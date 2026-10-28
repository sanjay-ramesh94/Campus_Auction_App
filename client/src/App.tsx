import { useState, useEffect, useCallback } from 'react';
import type { User, ToastMessage, NotificationItem } from './types';
import { AuthModal } from './components/AuthModal';
import { Header } from './components/Header';
import { BuyerHome } from './components/BuyerHome';
import { LiveAuctionDetail } from './components/LiveAuctionDetail';
import { SellerDashboard } from './components/SellerDashboard';
import { MyBidsTab } from './components/MyBidsTab';
import { AiAssistantTab } from './components/AiAssistantTab';
import { WatchlistTab } from './components/WatchlistTab';
import { OnboardingModal } from './components/OnboardingModal';
import { Toast } from './components/Toast';

export function App() {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('campus_auction_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('campus_auction_token');
  });

  const [activeTab, setActiveTab] = useState<string>('listings');
  const [selectedAuctionId, setSelectedAuctionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [connected, setConnected] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(1);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);

  // Default tab on login
  useEffect(() => {
    if (user) {
      if (user.role === 'seller') {
        setActiveTab('sell');
      } else {
        setActiveTab('listings');
      }
    }
  }, [user?.role]);

  const showToast = useCallback(
    (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((prev) => [...prev, { id, type, title, message, timestamp: Date.now() }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5000);
    },
    []
  );

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/notifications', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount !== undefined ? data.unreadCount : 1);
      }
    } catch (err) {
      console.error(err);
    }
  }, [token]);

  useEffect(() => {
    fetchNotifications();
    const timer = setInterval(fetchNotifications, 6000);
    return () => clearInterval(timer);
  }, [fetchNotifications]);

  // Browser Push Notification trigger
  const sendBrowserPush = useCallback((title: string, body: string) => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body,
          icon: '/favicon.ico',
        });
      } catch (err) {
        console.warn('Browser push notification error:', err);
      }
    }
  }, []);

  // Audio tone cue for winning or losing an auction
  const playAlertChime = useCallback((type: 'won' | 'lost') => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'won') {
        osc.frequency.setValueAtTime(523.25, ctx.currentTime);
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.12);
        osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.24);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      } else {
        osc.frequency.setValueAtTime(392.0, ctx.currentTime);
        osc.frequency.setValueAtTime(329.63, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      }
    } catch {}
  }, []);

  // Connect to SSE live feed
  useEffect(() => {
    const sseUrl = token ? `/api/events?token=${encodeURIComponent(token)}` : '/api/events';
    const eventSource = new EventSource(sseUrl);

    eventSource.onopen = () => setConnected(true);
    eventSource.onerror = () => setConnected(false);

    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'CONNECTED') return;

        fetchNotifications();

        const currentUserId = user?.id;
        const targetId = event.targetUserId
          ? (typeof event.targetUserId === 'object' ? (event.targetUserId.$oid || event.targetUserId.toString()) : event.targetUserId.toString())
          : null;

        const isForMe = Boolean(currentUserId && targetId && currentUserId.toString() === targetId);

        if (event.type === 'AUCTION_WON') {
          if (isForMe) {
            const title = event.payload?.title || 'Auction Item';
            const price = event.payload?.finalPrice || event.payload?.amount || '';
            const msg = event.payload?.message || `You won "${title}" with a bid of ₹${price}!`;
            showToast('success', '🏆 AUCTION WON!', msg);
            sendBrowserPush('🏆 CampusBid — Auction Won!', msg);
            playAlertChime('won');
          }
        } else if (event.type === 'AUCTION_LOST') {
          if (isForMe) {
            const title = event.payload?.title || 'Auction Item';
            const price = event.payload?.finalPrice || '';
            const msg = event.payload?.message || `Auction for "${title}" ended (final ₹${price}). You were outbid.`;
            showToast('warning', '⏱️ AUCTION LOST', msg);
            sendBrowserPush('⏱️ CampusBid — Auction Ended', msg);
            playAlertChime('lost');
          }
        } else if (event.type === 'AUCTION_APPROVED') {
          if (isForMe) {
            const title = event.payload?.title || 'Auction Item';
            const msg = event.payload?.message || `The seller approved your bid for "${title}". Ready for handover!`;
            showToast('success', '🎉 BID APPROVED!', msg);
            sendBrowserPush('🎉 CampusBid — Bid Approved!', msg);
            playAlertChime('won');
          }
        } else if (event.type === 'AUCTION_REJECTED') {
          if (isForMe) {
            const title = event.payload?.title || 'Auction Item';
            const msg = event.payload?.message || `The seller rejected the final bid on "${title}".`;
            showToast('error', 'Bid Not Approved', msg);
            sendBrowserPush('CampusBid — Bid Rejected', msg);
            playAlertChime('lost');
          }
        } else if (event.type === 'DEADLINE_EXTENDED') {
          showToast('warning', '🛡️ Anti-Sniping Protection', 'A bid landed in the final 30s! Deadline extended by +60s.');
        } else if (event.type === 'OUTBID') {
          if (isForMe) {
            const title = event.payload?.title || 'Item';
            const msg = `You were outbid! New high bid of ₹${event.payload?.newPrice}.`;
            showToast('error', '⚠️ You Were Outbid!', msg);
            sendBrowserPush('⚠️ Outbid on CampusBid', `New highest bid of ₹${event.payload?.newPrice} on "${title}".`);
            playAlertChime('lost');
          }
        } else if (event.type === 'AUTO_BID_PLACED') {
          if (isForMe) {
            const title = event.payload?.title || 'Item';
            const price = event.payload?.currentPrice ?? event.payload?.price ?? '';
            const maxBudget = event.payload?.maxBudget ?? '';
            const msg = `Auto-bid placed on "${title}" at ₹${price} (Budget cap ₹${maxBudget}).`;
            showToast('success', '⚡ Auto-Bid Placed!', msg);
            sendBrowserPush('⚡ CampusBid — Auto-Bid Placed', msg);
            playAlertChime('won');
          }
        } else if (event.type === 'AUTO_BID_OUTBID') {
          if (isForMe) {
            const title = event.payload?.title || 'Item';
            const newPrice = event.payload?.newPrice ?? '';
            const maxBudget = event.payload?.maxBudget ?? '';
            const msg = `Outbid on "${title}" at ₹${newPrice}. Exceeds your ₹${maxBudget} budget. Auto-bid paused.`;
            showToast('warning', '⚠️ Auto-Bid Budget Exceeded', msg);
            sendBrowserPush('⚠️ Auto-Bid Limit Reached', msg);
            playAlertChime('lost');
          }
        } else if (event.type === 'WATCH_FULFILLED') {
          if (isForMe) {
            const title = event.payload?.title || 'Item';
            const price = event.payload?.price ?? '';
            const msg = `Congratulations! You won "${title}" (₹${price}) via your auto-bid watch!`;
            showToast('success', '🏆 Watch Won & Fulfilled!', msg);
            sendBrowserPush('🏆 CampusBid — Watch Won!', msg);
            playAlertChime('won');
          }
        } else if (event.type === 'WATCH_MATCH') {
          if (isForMe) {
            const title = event.payload?.title || 'Matching Item';
            const price = event.payload?.price ? ` at ₹${event.payload.price}` : '';
            const msg = `New listing matching your alert: "${title}"${price}!`;
            showToast('info', '🔔 Watch Alert Match!', msg);
            sendBrowserPush('🔔 CampusBid Watch Alert!', msg);
            playAlertChime('won');
          }
        } else if (event.type === 'AUCTION_ENDED') {
          if (isForMe) {
            showToast('info', 'Auction Ended', `Status: ${event.payload?.status}`);
          }
        }
      } catch (err) {
        console.error(err);
      }
    };

    return () => eventSource.close();
  }, [fetchNotifications, showToast, user, token, sendBrowserPush, playAlertChime]);

  const handleLoginSuccess = (loggedInUser: User, authToken: string) => {
    setUser(loggedInUser);
    setToken(authToken);
    localStorage.setItem('campus_auction_user', JSON.stringify(loggedInUser));
    localStorage.setItem('campus_auction_token', authToken);

    if (loggedInUser.role === 'seller') {
      setActiveTab('sell');
    } else {
      setActiveTab('listings');
    }

    const seenOnboard = localStorage.getItem(`onboard_${loggedInUser.id}`);
    if (!seenOnboard) {
      setShowOnboarding(true);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setToken(null);
    setSelectedAuctionId(null);
    localStorage.removeItem('campus_auction_user');
    localStorage.removeItem('campus_auction_token');
    showToast('info', 'Logged Out', 'You have been signed out successfully.');
  };

  const handleMarkNotificationRead = async (id: string) => {
    if (!token) return;
    try {
      await fetch(`/api/notifications/${id}/read`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchNotifications();
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    if (!token) return;
    try {
      await fetch('/api/notifications/read-all', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchNotifications();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSelectTab = (tab: string) => {
    setSelectedAuctionId(null);
    setActiveTab(tab);
  };

  const handleSelectAuction = (id: string) => {
    setSelectedAuctionId(id);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  // If not logged in, display Screen 1 (Login Page)
  if (!user || !token) {
    return (
      <>
        <AuthModal onSuccess={handleLoginSuccess} />
        <Toast toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
      </>
    );
  }

  return (
    <div>
      {/* Top Dark Header matching Screens 2, 3, 4, 5 */}
      <Header
        user={user}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        connected={connected}
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkNotificationRead={handleMarkNotificationRead}
        onMarkAllNotificationsRead={handleMarkAllNotificationsRead}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onLogout={handleLogout}
      />

      {/* Main Content Router */}
      <main>
        {/* If an auction is selected, render Screen 3 with Image 2 Live Participants */}
        {selectedAuctionId ? (
          <LiveAuctionDetail
            auctionId={selectedAuctionId}
            user={user}
            token={token}
            onBackToListings={() => setSelectedAuctionId(null)}
            onShowToast={showToast}
          />
        ) : (
          <>
            {/* Screen 2: Listings Page */}
            {(activeTab === 'listings' || activeTab === 'browse') && (
              <BuyerHome
                user={user}
                token={token}
                searchQuery={searchQuery}
                onSelectAuction={handleSelectAuction}
                onShowToast={showToast}
              />
            )}

            {/* Screen 5: Buyer Dashboard (My Bids) */}
            {activeTab === 'my_bids' && (
              <MyBidsTab
                user={user}
                token={token}
                onSelectAuction={handleSelectAuction}
                onShowToast={showToast}
              />
            )}

            {/* Screen 4: Seller / Create Listing Page (Seller Only) */}
            {(activeTab === 'sell' || activeTab === 'dashboard') && user.role === 'seller' && (
              <SellerDashboard
                user={user}
                token={token}
                onSelectAuction={handleSelectAuction}
                onShowToast={showToast}
              />
            )}

            {/* Watches & Auto-Bids Tab (Buyer Only) */}
            {(activeTab === 'watches' || activeTab === 'watchlist') && user.role !== 'seller' && (
              <div className="app-body-container">
                <WatchlistTab
                  token={token}
                  showToast={showToast}
                  onSelectAuction={handleSelectAuction}
                />
              </div>
            )}

            {/* AI Assistant Tab (Buyer Only) */}
            {activeTab === 'ai_assistant' && user.role !== 'seller' && (
              <div className="app-body-container">
                <AiAssistantTab
                  token={token}
                  showToast={showToast}
                  onSelectAuction={handleSelectAuction}
                />
              </div>
            )}
          </>
        )}
      </main>

      {/* One-Time Onboarding Prompt */}
      {showOnboarding && (
        <OnboardingModal
          user={user}
          token={token}
          onComplete={(updatedName) => {
            if (updatedName) setUser({ ...user, name: updatedName });
            localStorage.setItem(`onboard_${user.id}`, 'true');
            setShowOnboarding(false);
          }}
          showToast={showToast}
        />
      )}

      {/* Global Toast Container */}
      <Toast toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </div>
  );
}

export default App;
