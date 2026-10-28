import { useState, useEffect, useCallback } from 'react';
import type { User, ToastMessage, NotificationItem, Auction } from './types';
import { AuthModal } from './components/AuthModal';
import { Header } from './components/Header';
import { SellerDashboard } from './components/SellerDashboard';
import { BuyerHome } from './components/BuyerHome';
import { MyBidsTab } from './components/MyBidsTab';
import { WatchlistTab } from './components/WatchlistTab';
import { AiAssistantTab } from './components/AiAssistantTab';
import { CreateListingModal } from './components/CreateListingModal';
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

  const [activeTab, setActiveTab] = useState<string>('browse');
  const [connected, setConnected] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);

  // Set default tab on login based on role
  useEffect(() => {
    if (user) {
      if (user.role === 'seller') {
        setActiveTab('dashboard');
      } else {
        setActiveTab('browse');
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
        setUnreadCount(data.unreadCount || 0);
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

        // Broadcast notifications
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

    // If first time logged in on this browser, show onboarding
    const seenOnboard = localStorage.getItem(`onboard_${loggedInUser.id}`);
    if (!seenOnboard) {
      setShowOnboarding(true);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setToken(null);
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

  // Role Guard: Prevents Buyer from opening Seller dashboard and vice-versa
  const handleSelectTab = (tab: string) => {
    if (!user) return;
    if (user.role === 'buyer' && (tab === 'dashboard' || tab === 'create')) {
      showToast('error', 'Access Denied', 'Only Sellers (Semesters 7, 8, 9) have access to Seller Dashboard.');
      return;
    }
    if (user.role === 'seller' && ['my_bids', 'watchlist', 'ai_assistant'].includes(tab)) {
      showToast('error', 'Sellers Cannot Buy', 'Sellers cannot participate in bidding or set buyer alerts.');
      return;
    }
    setActiveTab(tab);
  };

  if (!user || !token) {
    return (
      <div className="app-container">
        <AuthModal onSuccess={handleLoginSuccess} showToast={showToast} />
        <Toast toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Role-Aware Header */}
      <Header
        user={user}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        connected={connected}
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkNotificationRead={handleMarkNotificationRead}
        onMarkAllNotificationsRead={handleMarkAllNotificationsRead}
        onOpenCreateModal={() => setIsCreateOpen(true)}
        onLogout={handleLogout}
      />

      {/* Main View Router based on Role & Active Tab */}
      <main className="main-viewport">
        {user.role === 'seller' ? (
          /* SELLER FLOW (Sem 7, 8, 9) */
          <SellerDashboard
            token={token}
            onOpenCreateModal={() => setIsCreateOpen(true)}
            showToast={showToast}
          />
        ) : (
          /* BUYER FLOW (Other Sems) */
          <>
            {activeTab === 'browse' && (
              <BuyerHome user={user} token={token} showToast={showToast} />
            )}
            {activeTab === 'my_bids' && (
              <MyBidsTab
                token={token}
                onSelectAuction={(_a: Auction) => setActiveTab('browse')}
              />
            )}
            {activeTab === 'watchlist' && (
              <WatchlistTab token={token} showToast={showToast} />
            )}
            {activeTab === 'ai_assistant' && (
              <AiAssistantTab token={token} showToast={showToast} />
            )}
          </>
        )}
      </main>

      {/* Seller Create Listing Modal */}
      {user.role === 'seller' && (
        <CreateListingModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          token={token}
          onCreated={() => {
            setActiveTab('dashboard');
          }}
          showToast={showToast}
        />
      )}

      {/* Optional One-Time Onboarding Prompt */}
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
