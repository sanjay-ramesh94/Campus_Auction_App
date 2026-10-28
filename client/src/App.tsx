import { useState, useEffect, useCallback } from 'react';
import type { User, ToastMessage, NotificationItem } from './types';
import { AuthModal } from './components/AuthModal';
import { Header } from './components/Header';
import { BuyerHome } from './components/BuyerHome';
import { LiveAuctionDetail } from './components/LiveAuctionDetail';
import { SellerDashboard } from './components/SellerDashboard';
import { MyBidsTab } from './components/MyBidsTab';
import { AiAssistantTab } from './components/AiAssistantTab';
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

  // Connect to SSE live feed
  useEffect(() => {
    const eventSource = new EventSource('/api/events');

    eventSource.onopen = () => setConnected(true);
    eventSource.onerror = () => setConnected(false);

    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'CONNECTED') return;

        fetchNotifications();

        if (event.type === 'DEADLINE_EXTENDED') {
          showToast('warning', '🛡️ Anti-Sniping Protection', 'A bid landed in the final 30s! Deadline extended by +60s.');
        } else if (event.type === 'OUTBID') {
          if (user && event.targetUserId === user.id) {
            showToast('error', '⚠️ You Were Outbid!', `New high bid of ₹${event.payload?.newPrice}.`);
          }
        } else if (event.type === 'AUCTION_ENDED') {
          if (user && event.targetUserId === user.id) {
            showToast('info', 'Auction Ended', `Status: ${event.payload?.status}`);
          }
        }
      } catch (err) {
        console.error(err);
      }
    };

    return () => eventSource.close();
  }, [fetchNotifications, showToast, user]);

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

            {/* Screen 4: Seller / Create Listing Page */}
            {(activeTab === 'sell' || activeTab === 'dashboard') && (
              <SellerDashboard
                user={user}
                token={token}
                onSelectAuction={handleSelectAuction}
                onShowToast={showToast}
              />
            )}

            {/* AI Assistant Tab */}
            {activeTab === 'ai_assistant' && (
              <div className="app-body-container">
                <AiAssistantTab token={token} showToast={showToast} />
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
