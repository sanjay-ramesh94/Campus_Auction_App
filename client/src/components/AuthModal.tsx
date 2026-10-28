import React, { useState } from 'react';
import type { User, UserRole } from '../types';

interface AuthModalProps {
  onSuccess: (user: User, token: string) => void;
  showToast: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onSuccess, showToast }) => {
  const [step, setStep] = useState<'email' | 'set_password' | 'enter_password'>('email');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [detectedRole, setDetectedRole] = useState<UserRole | null>(null);
  const [detectedSem, setDetectedSem] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Sample roster hints for quick 1-click testing
  const demoAccounts = [
    { email: 'seller.sam@campus.edu', label: 'Sam (Sem 8 · Seller)', role: 'seller' },
    { email: 'priya.senior@campus.edu', label: 'Priya (Sem 7 · Seller)', role: 'seller' },
    { email: 'buyer.bob@campus.edu', label: 'Bob (Sem 4 · Buyer)', role: 'buyer' },
    { email: 'arun.buyer@campus.edu', label: 'Arun (Sem 2 · Buyer)', role: 'buyer' },
    { email: 'unassigned.student@campus.edu', label: 'Test Blank Sem (Error)', role: 'error' },
  ];

  const handleCheckEmail = async (overrideEmail?: string) => {
    const targetEmail = (overrideEmail || email).trim().toLowerCase();
    if (!targetEmail) {
      setErrorMsg('Please enter your college email');
      return;
    }
    setErrorMsg('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "Your email isn't registered with the campus list");
        return;
      }

      setEmail(data.email);
      setName(data.name || '');
      setDetectedRole(data.role);
      setDetectedSem(data.sem);

      if (data.hasPassword) {
        setStep('enter_password');
        showToast('info', 'Welcome Back!', `Role: ${data.role.toUpperCase()} (Sem ${data.sem})`);
      } else {
        setStep('set_password');
        showToast('info', 'First Time Login', `Please create a secure password for your account.`);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters');
      return;
    }
    setErrorMsg('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, confirmPassword, name }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || 'Failed to set password');
        return;
      }

      showToast('success', 'Password Created!', 'Please enter your password to log in.');
      setPassword('');
      setConfirmPassword('');
      setStep('enter_password');
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setErrorMsg('Password is required');
      return;
    }
    setErrorMsg('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || 'Incorrect password');
        return;
      }

      showToast('success', 'Logged In!', `Welcome, ${data.user.name} (${data.user.role.toUpperCase()})`);
      onSuccess(data.user, data.token);
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-overlay">
      <div className="auth-card">
        {/* Brand Banner */}
        <div className="auth-header">
          <div className="auth-logo">🏛️</div>
          <h2 className="auth-title">CampusBid Portal</h2>
          <p className="auth-subtitle">Official Student Auction & Marketplace</p>
        </div>

        {errorMsg && (
          <div className="auth-error-banner" role="alert">
            <span>⚠️</span> {errorMsg}
          </div>
        )}

        {/* STEP 1: Enter Email */}
        {step === 'email' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCheckEmail();
            }}
            className="auth-form"
          >
            <div className="form-group">
              <label>College Email Address</label>
              <input
                type="email"
                className="form-input"
                placeholder="student@campus.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
              <span className="auth-hint">
                Backend checks campus roster. Sem 7-9 assigned as <strong>Seller</strong>; other sems assigned as <strong>Buyer</strong>.
              </span>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
              {loading ? 'Verifying Roster...' : 'Continue with Campus Email →'}
            </button>

            {/* Quick Demo Roster Accounts */}
            <div className="demo-accounts-box">
              <span className="demo-accounts-label">Demo Roster Accounts (1-Click Test):</span>
              <div className="demo-chips">
                {demoAccounts.map((acc) => (
                  <button
                    key={acc.email}
                    type="button"
                    className="demo-chip"
                    onClick={() => {
                      setEmail(acc.email);
                      handleCheckEmail(acc.email);
                    }}
                  >
                    {acc.label}
                  </button>
                ))}
              </div>
            </div>
          </form>
        )}

        {/* STEP 2: First Time User - Set Password */}
        {step === 'set_password' && (
          <form onSubmit={handleSetPassword} className="auth-form">
            <div className="role-detected-banner">
              <div className="role-tag-pill">
                {detectedRole === 'seller' ? '🎓 Seller Mode' : '🎒 Buyer Mode'}
              </div>
              <p>
                <strong>{name || email}</strong> · Semester {detectedSem}
              </p>
              <small>No password set yet. Create a password for future logins.</small>
            </div>

            <div className="form-group">
              <label>Your Display Name</label>
              <input
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sam Wilson"
                required
              />
            </div>

            <div className="form-group">
              <label>Create Password</label>
              <input
                type="password"
                className="form-input"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Re-enter Password</label>
              <input
                type="password"
                className="form-input"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
              {loading ? 'Saving Password...' : 'Save Password & Proceed to Login'}
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              style={{ width: '100%', marginTop: '0.25rem' }}
              onClick={() => {
                setStep('email');
                setErrorMsg('');
              }}
            >
              ← Use Different Email
            </button>
          </form>
        )}

        {/* STEP 3: Enter Password & Log in */}
        {step === 'enter_password' && (
          <form onSubmit={handleLogin} className="auth-form">
            <div className="role-detected-banner">
              <div className="role-tag-pill">
                {detectedRole === 'seller' ? '🎓 Seller Mode' : '🎒 Buyer Mode'}
              </div>
              <p>
                <strong>{name || email}</strong> · Sem {detectedSem}
              </p>
              <small>Role verified server-side via authorized campus roster.</small>
            </div>

            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                className="form-input"
                placeholder="Enter your account password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
              {loading ? 'Authenticating...' : 'Sign In to CampusBid'}
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              style={{ width: '100%', marginTop: '0.25rem' }}
              onClick={() => {
                setStep('email');
                setErrorMsg('');
                setPassword('');
              }}
            >
              ← Switch Email
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
