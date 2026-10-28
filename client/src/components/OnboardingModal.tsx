import React, { useState } from 'react';
import type { User } from '../types';

interface OnboardingModalProps {
  user: User;
  token: string;
  onComplete: (updatedName?: string) => void;
  showToast: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  user,
  token,
  onComplete,
  showToast,
}) => {
  const [name, setName] = useState(user.name);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRequestPush = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        setPushEnabled(true);
        showToast('success', 'Notifications Enabled', 'You will receive desktop alerts for outbids & extensions.');
      } else {
        showToast('info', 'Permission Denied', 'Browser notifications were not allowed.');
      }
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await fetch('/api/auth/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim() || user.name,
          notifPrefs: { push: pushEnabled },
        }),
      });

      onComplete(name.trim() || user.name);
    } catch {
      onComplete();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '440px', textAlign: 'center', padding: '2.25rem 2rem' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.35rem' }}>🎉</div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.45rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
          Welcome to CampusBid!
        </h2>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: '1.5' }}>
          Personalize your campus profile and notification settings.
        </p>

        <form onSubmit={handleSave} style={{ textAlign: 'left' }}>
          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label className="form-label">Display Name</label>
            <input
              type="text"
              className="input-field"
              style={{ paddingLeft: '1rem' }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your preferred name"
              required
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              padding: '0.9rem',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              marginBottom: '1.5rem',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                Browser Push Notifications
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                Instant desktop alerts when you are outbid or when watch items are listed.
              </div>
            </div>
            <button
              type="button"
              className="btn-outline-action"
              style={{
                fontSize: '0.78rem',
                padding: '0.4rem 0.85rem',
                whiteSpace: 'nowrap',
                background: pushEnabled ? '#ecfdf5' : '#ffffff',
                borderColor: pushEnabled ? '#10b981' : '#0f172a',
                color: pushEnabled ? '#059669' : '#0f172a',
                fontWeight: 600,
              }}
              onClick={handleRequestPush}
            >
              {pushEnabled ? '✓ Enabled' : 'Enable'}
            </button>
          </div>

          <button
            type="submit"
            className="btn-primary-dark"
            disabled={loading}
          >
            {loading ? 'Saving...' : 'Get Started →'}
          </button>
        </form>
      </div>
    </div>
  );
};
