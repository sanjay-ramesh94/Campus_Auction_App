import React, { useState } from 'react';
import type { User } from '../types';

interface AuthModalProps {
  onSuccess: (user: User, token: string) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onSuccess }) => {
  const [mode, setMode] = useState<'signin' | 'signup' | 'set_password'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSelectQuickAccount = (r: any) => {
    setEmail(r.email);
    setPassword('password123');
    setError(null);
    setSuccessMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const normEmail = email.trim().toLowerCase();
    if (!normEmail) {
      setError('Please enter your college email');
      return;
    }

    setLoading(true);

    try {
      // Step 1: Check College Email in authorizedStudents Roster
      const checkRes = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normEmail }),
      });
      const checkData = await checkRes.json();

      if (!checkRes.ok) {
        setError(checkData.error || "Your email isn't registered with the campus list");
        setLoading(false);
        return;
      }

      // If user has no password yet, route to password creation
      if (!checkData.hasPassword) {
        setName(checkData.name || '');
        setMode('set_password');
        setSuccessMsg(`Welcome ${checkData.name || 'Student'} (${checkData.role.toUpperCase()} · Sem ${checkData.sem})! Please set your new password.`);
        setLoading(false);
        return;
      }

      // If in sign-in mode and has password, submit login
      if (mode === 'signin' || mode === 'signup') {
        if (!password) {
          setError('Please enter your password');
          setLoading(false);
          return;
        }

        const loginRes = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: normEmail, password }),
        });
        const loginData = await loginRes.json();

        if (!loginRes.ok) {
          setError(loginData.error || 'Incorrect password');
          setLoading(false);
          return;
        }

        onSuccess(loginData.user, loginData.token);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication error');
    } finally {
      setLoading(false);
    }
  };

  const handleSetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!password || !confirmPassword) {
      setError('Please fill in both password fields');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          confirmPassword,
          name,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to create password');
        setLoading(false);
        return;
      }

      // Automatically log the student in after creating password
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const loginData = await loginRes.json();

      if (loginRes.ok) {
        onSuccess(loginData.user, loginData.token);
      } else {
        setMode('signin');
        setSuccessMsg('Password created! Please sign in with your password.');
      }
    } catch (err: any) {
      setError(err.message || 'Error creating password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen-wrapper">
      {/* Left Pane: Split-Screen Hero */}
      <div className="login-hero-pane">
        <div className="login-hero-overlay" />
        <div className="login-hero-content">
          {/* Logo */}
          <div className="login-hero-brand">
            <div className="brand-logo-icon">🎓</div>
            <h1 className="brand-title">CampusBid</h1>
          </div>

          {/* Center Heading & Subtitle */}
          <div className="login-hero-center">
            <h2 className="login-hero-heading">Buy. Sell. Reuse.</h2>
            <p className="login-hero-subheading">
              A student-to-student auction platform for a smarter campus.
            </p>

            {/* Feature Bullets */}
            <div className="login-hero-features">
              <div className="login-feature-item">
                <span className="login-feature-icon">🛡️</span>
                <span>Verified Students</span>
              </div>
              <div className="login-feature-item">
                <span className="login-feature-icon">🔒</span>
                <span>Safe & Secure</span>
              </div>
              <div className="login-feature-item">
                <span className="login-feature-icon">🌱</span>
                <span>Sustainable Campus</span>
              </div>
            </div>
          </div>

          {/* Footer note */}
          <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
            Built for campus dorms, labs, and student communities.
          </div>
        </div>
      </div>

      {/* Right Pane: Login Form Card */}
      <div className="login-form-pane">
        <div className="login-card">
          <div className="login-header-text">
            <h2 className="login-title">
              {mode === 'set_password' ? 'Create Password' : 'Welcome Back'}
            </h2>
            <p className="login-subtitle">
              {mode === 'set_password'
                ? 'First-time login: please set your password'
                : 'Sign in to your CampusBid account'}
            </p>
          </div>

          {error && <div className="error-banner">⚠️ {error}</div>}
          {successMsg && <div className="success-banner">✨ {successMsg}</div>}

          {mode === 'set_password' ? (
            /* Set Password Form */
            <form onSubmit={handleSetPasswordSubmit}>
              <div className="form-group">
                <label className="form-label">College Email</label>
                <div className="input-with-icon">
                  <span className="input-icon">✉️</span>
                  <input
                    type="email"
                    className="input-field"
                    value={email}
                    disabled
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Create Password</label>
                <div className="input-with-icon">
                  <span className="input-icon">🔒</span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="input-field"
                    placeholder="Enter at least 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="input-eye-btn"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? '👁️' : '👁️‍🗨️'}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Re-enter Password</label>
                <div className="input-with-icon">
                  <span className="input-icon">🔒</span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="input-field"
                    placeholder="Confirm your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn-primary-dark"
                disabled={loading}
              >
                {loading ? 'Setting Password...' : 'Save & Log In'}
              </button>
            </form>
          ) : (
            /* Sign In / Sign Up Form */
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">College Email</label>
                <div className="input-with-icon">
                  <span className="input-icon">✉️</span>
                  <input
                    type="email"
                    className="input-field"
                    placeholder="e.g. atchayaa.21alr@kongu.edu"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Password</label>
                <div className="input-with-icon">
                  <span className="input-icon">🔒</span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="input-field"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="input-eye-btn"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? '👁️' : '👁️‍🗨️'}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="btn-primary-dark"
                disabled={loading}
              >
                {loading ? 'Checking Roster...' : 'Sign In'}
              </button>

              <div className="login-allowed-note" style={{ marginTop: '1rem' }}>
                Only college accounts are allowed
              </div>

              <div className="login-footer-text">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    if (email) handleSubmit({ preventDefault: () => {} } as any);
                    else setError('Please enter your college email to verify roster authorization');
                  }}
                >
                  Sign Up
                </button>
              </div>
            </form>
          )}

          {/* Quick Roster Account Chips for 1-Click Evaluation */}
          <div className="test-accounts-panel">
            <div className="test-accounts-title">1-Click Test Accounts from Roster:</div>
            <div className="test-chips">
              <button
                type="button"
                className="test-chip"
                onClick={() => handleSelectQuickAccount({ email: 'seller.sam@campus.edu' })}
              >
                Sam (Seller · Sem 8)
              </button>
              <button
                type="button"
                className="test-chip"
                onClick={() => handleSelectQuickAccount({ email: 'buyer.bob@campus.edu' })}
              >
                Bob (Buyer · Sem 4)
              </button>
              <button
                type="button"
                className="test-chip"
                onClick={() => handleSelectQuickAccount({ email: 'atchayaa.21alr@kongu.edu' })}
              >
                Atchaya (Sem 7 Seller)
              </button>
              <button
                type="button"
                className="test-chip"
                onClick={() => handleSelectQuickAccount({ email: 'sreesanthc.25mtr@kongu.edu' })}
              >
                Sreesanth (Sem 1 Buyer)
              </button>
              <button
                type="button"
                className="test-chip"
                onClick={() => handleSelectQuickAccount({ email: 'unassigned.student@campus.edu' })}
              >
                Invalid Sem (Contact Admin)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
