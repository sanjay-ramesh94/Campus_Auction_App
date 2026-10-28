import React, { useState, useRef, useEffect } from 'react';
import type { User, NotificationItem } from '../types';

interface HeaderProps {
  user: User;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  connected: boolean;
  notifications: NotificationItem[];
  unreadCount: number;
  onMarkNotificationRead: (id: string) => void;
  onMarkAllNotificationsRead: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  activeTab,
  onSelectTab,
  notifications,
  unreadCount,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  searchQuery,
  onSearchChange,
  onLogout,
}) => {
  const [showNotifs, setShowNotifs] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [sellerGuardAlert, setSellerGuardAlert] = useState(false);

  const notifsRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside anywhere on the page
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
      if (notifsRef.current && !notifsRef.current.contains(event.target as Node)) {
        setShowNotifs(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleTabClick = (tabKey: string) => {
    if (tabKey === 'sell' && user.role !== 'seller') {
      setSellerGuardAlert(true);
      return;
    }
    onSelectTab(tabKey);
  };

  const initial = user.name ? user.name[0].toUpperCase() : user.role === 'seller' ? 'S' : 'B';

  return (
    <>
      <header className="app-header">
        <div className="header-inner">
          {/* Logo */}
          <div className="brand" onClick={() => onSelectTab('listings')}>
            <div className="brand-logo-icon">🎓</div>
            <h1 className="brand-title">CampusBid</h1>
          </div>

          {/* Navigation Tabs */}
          <nav className="header-nav">
            <button
              className={`header-tab-btn ${activeTab === 'listings' || activeTab === 'browse' ? 'active' : ''}`}
              onClick={() => handleTabClick('listings')}
            >
              Listings
            </button>
            <button
              className={`header-tab-btn ${activeTab === 'my_bids' ? 'active' : ''}`}
              onClick={() => handleTabClick('my_bids')}
            >
              My Bids
            </button>
            {user.role === 'seller' && (
              <button
                className={`header-tab-btn ${activeTab === 'sell' || activeTab === 'seller_panel' || activeTab === 'dashboard' ? 'active' : ''}`}
                onClick={() => handleTabClick('sell')}
              >
                Seller Panel
              </button>
            )}
            {user.role !== 'seller' && (
              <button
                className={`header-tab-btn ${activeTab === 'watches' || activeTab === 'watchlist' ? 'active' : ''}`}
                onClick={() => handleTabClick('watchlist')}
              >
                Watches & Alerts
              </button>
            )}
            {user.role !== 'seller' && (
              <button
                className={`header-tab-btn ${activeTab === 'ai_assistant' ? 'active' : ''}`}
                onClick={() => handleTabClick('ai_assistant')}
              >
                AI Assistant
              </button>
            )}
          </nav>

          {/* Right Header Controls */}
          <div className="header-right">
            {/* Search Input */}
            <div className="header-search">
              <span className="header-search-icon">🔍</span>
              <input
                type="text"
                className="header-search-input"
                placeholder="Search items, categories..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
              />
            </div>

            {/* Notification Bell */}
            <div ref={notifsRef} style={{ position: 'relative' }}>
              <button
                className="header-icon-btn"
                title="Notifications"
                onClick={() => setShowNotifs(!showNotifs)}
              >
                <span>🔔</span>
                {unreadCount > 0 && <span className="notif-badge">{unreadCount}</span>}
              </button>

              {showNotifs && (
                <div className="notifications-dropdown">
                  <div className="notifications-header">
                    <span>Notifications ({unreadCount} new)</span>
                    {unreadCount > 0 && (
                      <button
                        style={{ background: 'none', border: 'none', color: '#0f172a', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}
                        onClick={() => {
                          onMarkAllNotificationsRead();
                          setShowNotifs(false);
                        }}
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  {typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default' && (
                    <div
                      style={{
                        padding: '0.65rem 0.85rem',
                        background: '#eff6ff',
                        borderBottom: '1px solid #dbeafe',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '0.78rem',
                      }}
                    >
                      <span style={{ color: '#1e40af', fontWeight: 500 }}>🔔 Enable browser push alerts?</span>
                      <button
                        onClick={() => {
                          Notification.requestPermission().then(() => setShowNotifs(false));
                        }}
                        style={{
                          padding: '0.25rem 0.6rem',
                          background: '#2563eb',
                          color: '#fff',
                          borderRadius: '4px',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontSize: '0.75rem',
                        }}
                      >
                        Enable
                      </button>
                    </div>
                  )}
                  {notifications.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8', fontSize: '0.8rem' }}>
                      No notifications yet
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n._id}
                        className={`notification-item ${!n.readAt ? 'unread' : ''}`}
                        onClick={() => {
                          onMarkNotificationRead(n._id);
                          setShowNotifs(false);
                        }}
                      >
                        <div className="notification-title">{n.title}</div>
                        <div className="notification-msg">{n.message}</div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* User Profile Avatar with Click-Outside Ref */}
            <div ref={userMenuRef} style={{ position: 'relative' }}>
              <button
                className="user-avatar-btn"
                onClick={() => setShowUserMenu(!showUserMenu)}
                title={user.name}
              >
                {initial}
              </button>

              {showUserMenu && (
                <div className="user-menu-dropdown">
                  <div className="user-menu-header">
                    <div className="user-menu-name">{user.name}</div>
                    <div className="user-menu-email">{user.email}</div>
                    <div className={`user-role-badge ${user.role}`}>
                      {user.role === 'seller' ? `Seller · Sem ${user.sem}` : `Buyer · Sem ${user.sem}`}
                    </div>
                  </div>

                  <button
                    className="user-menu-item"
                    onClick={() => {
                      onSelectTab('listings');
                      setShowUserMenu(false);
                    }}
                  >
                    🛍️ Browse Listings
                  </button>
                  <button
                    className="user-menu-item"
                    onClick={() => {
                      onSelectTab('my_bids');
                      setShowUserMenu(false);
                    }}
                  >
                    🏷️ My Bids & Activity
                  </button>
                  {user.role === 'seller' && (
                    <button
                      className="user-menu-item"
                      onClick={() => {
                        onSelectTab('sell');
                        setShowUserMenu(false);
                      }}
                    >
                      📊 Seller Dashboard
                    </button>
                  )}
                  <button
                    className="user-menu-item logout"
                    onClick={() => {
                      setShowUserMenu(false);
                      onLogout();
                    }}
                  >
                    🚪 Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Seller Role Guard Alert Modal */}
      {sellerGuardAlert && (
        <div className="modal-overlay" onClick={() => setSellerGuardAlert(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Graduating Seniors Only</h3>
              <button className="modal-close-btn" onClick={() => setSellerGuardAlert(false)}>×</button>
            </div>
            <p style={{ color: '#475569', fontSize: '0.92rem', lineHeight: '1.6', marginBottom: '1.25rem' }}>
              Per campus auction policy, listing items for sale is reserved for senior graduating students (Semesters 7, 8, and 9).
              <br /><br />
              Your registered semester is <strong>Semester {user.sem} (Buyer role)</strong>. As a registered buyer, you can browse, track, and bid on all campus auctions!
            </p>
            <button className="btn-primary-dark" onClick={() => setSellerGuardAlert(false)}>
              Back to Browse
            </button>
          </div>
        </div>
      )}
    </>
  );
};
