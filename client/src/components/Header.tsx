import React, { useState } from 'react';
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
  onOpenCreateModal: () => void;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  activeTab,
  onSelectTab,
  connected,
  notifications,
  unreadCount,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  onOpenCreateModal,
  onLogout,
}) => {
  const [showNotifs, setShowNotifs] = useState(false);

  return (
    <header className="app-header">
      <div className="header-inner">
        {/* Brand */}
        <div className="brand" onClick={() => onSelectTab(user.role === 'seller' ? 'dashboard' : 'browse')} style={{ cursor: 'pointer' }}>
          <div className="brand-icon">🏛️</div>
          <div>
            <h1 className="brand-title">CampusBid</h1>
            <p className="brand-subtitle">Campus Marketplace & Auction Engine</p>
          </div>
        </div>

        {/* Navigation Tabs based on Role */}
        <nav className="header-nav">
          {user.role === 'seller' ? (
            <>
              <button
                className={`nav-link ${activeTab === 'dashboard' ? 'active' : ''}`}
                onClick={() => onSelectTab('dashboard')}
              >
                📊 Seller Dashboard
              </button>
              <button
                className="btn btn-primary"
                onClick={onOpenCreateModal}
                style={{ padding: '0.45rem 1rem', fontSize: '0.8rem' }}
              >
                <span>+</span> Create Listing
              </button>
            </>
          ) : (
            <>
              <button
                className={`nav-link ${activeTab === 'browse' ? 'active' : ''}`}
                onClick={() => onSelectTab('browse')}
              >
                🔍 Browse Items
              </button>
              <button
                className={`nav-link ${activeTab === 'my_bids' ? 'active' : ''}`}
                onClick={() => onSelectTab('my_bids')}
              >
                🏷️ My Bids
              </button>
              <button
                className={`nav-link ${activeTab === 'watchlist' ? 'active' : ''}`}
                onClick={() => onSelectTab('watchlist')}
              >
                🔔 Looking For...
              </button>
              <button
                className={`nav-link ${activeTab === 'ai_assistant' ? 'active' : ''}`}
                onClick={() => onSelectTab('ai_assistant')}
              >
                ✨ AI Assistant
              </button>
            </>
          )}
        </nav>

        {/* Right Header Controls */}
        <div className="header-controls">
          {/* Live SSE Status */}
          <div className={`status-pill ${connected ? 'connected' : 'connecting'}`}>
            <span className="status-dot" />
            <span>{connected ? 'LIVE (SSE)' : 'Syncing...'}</span>
          </div>

          {/* Role & Semester Badge */}
          <div className={`role-pill ${user.role}`}>
            <span>{user.role === 'seller' ? '🎓' : '🎒'}</span>
            <span>
              {user.role.toUpperCase()} · Sem {user.sem}
            </span>
          </div>

          {/* Notification Bell */}
          <div className="notif-wrapper">
            <button
              className="btn-icon notif-btn"
              onClick={() => setShowNotifs(!showNotifs)}
              aria-label="Notifications"
            >
              🔔
              {unreadCount > 0 && <span className="notif-badge">{unreadCount}</span>}
            </button>

            {showNotifs && (
              <div className="notif-dropdown">
                <div className="notif-dropdown-header">
                  <span>Notifications ({unreadCount} unread)</span>
                  {unreadCount > 0 && (
                    <button className="notif-read-all" onClick={onMarkAllNotificationsRead}>
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="notif-dropdown-body">
                  {notifications.length === 0 ? (
                    <div className="notif-empty">No notifications yet.</div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n._id}
                        className={`notif-item ${!n.readAt ? 'unread' : ''}`}
                        onClick={() => onMarkNotificationRead(n._id)}
                      >
                        <div className="notif-title">{n.title}</div>
                        <div className="notif-desc">{n.message}</div>
                        <div className="notif-time">{new Date(n.createdAt).toLocaleTimeString()}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* User Profile Pill & Logout */}
          <div className="user-profile-menu">
            <span className="user-avatar">{user.role === 'seller' ? '👨‍🎓' : '👩‍🎓'}</span>
            <span className="user-display-name">{user.name}</span>
            <button className="btn-logout" onClick={onLogout} title="Log out">
              Exit
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
