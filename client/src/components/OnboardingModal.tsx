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
    } catch (err: any) {
      console.error(err);
      onComplete();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '440px' }}>
        <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
          <div style={{ fontSize: '2.5rem' }}>🎉</div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 800 }}>Welcome to CampusBid!</h2>
          <p style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
            Personalize your campus profile and notification settings.
          </p>
        </div>

        <form onSubmit={handleSave} className="form-grid">
          <div className="form-group">
            <label>Display Name</label>
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your preferred name"
              required
            />
          </div>

          <div className="onboard-push-row">
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Browser Push Notifications</div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                Instant desktop alerts when you are outbid or when watch items are listed.
              </div>
            </div>
            <button
              type="button"
              className={`btn ${pushEnabled ? 'btn-secondary' : 'btn-primary'}`}
              style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', whiteSpace: 'nowrap' }}
              onClick={handleRequestPush}
            >
              {pushEnabled ? '✓ Enabled' : 'Enable'}
            </button>
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} disabled={loading}>
            {loading ? 'Saving...' : 'Get Started →'}
          </button>
        </form>
      </div>
    </div>
  );
};
