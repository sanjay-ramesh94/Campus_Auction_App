import React from 'react';
import type { UserPersona } from '../types';

interface HeaderProps {
  connected: boolean;
  personas: UserPersona[];
  selectedPersona: UserPersona;
  onSelectPersona: (p: UserPersona) => void;
  onOpenCreateModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  connected,
  personas,
  selectedPersona,
  onSelectPersona,
  onOpenCreateModal,
}) => {
  return (
    <header className="app-header">
      <div className="header-inner">
        <div className="brand">
          <div className="brand-icon">🏛️</div>
          <div>
            <h1 className="brand-title">CampusBid</h1>
            <p className="brand-subtitle">MongoDB Transactional Engine & Real-Time Proxy Resolver</p>
          </div>
        </div>

        <div className="header-controls">
          {/* Connection status badge */}
          <div className={`status-pill ${connected ? 'connected' : 'connecting'}`}>
            <span className="status-dot" />
            <span>{connected ? 'LIVE (SSE)' : 'Connecting...'}</span>
          </div>

          {/* User persona selector */}
          <div className="persona-box">
            <span className="persona-label">Bidding as:</span>
            <select
              className="persona-select"
              value={selectedPersona.id}
              onChange={(e) => {
                const found = personas.find((p) => p.id === e.target.value);
                if (found) onSelectPersona(found);
              }}
            >
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.avatar} {p.name} ({p.role})
                </option>
              ))}
            </select>
          </div>

          {/* Create Auction button */}
          <button className="btn btn-primary" onClick={onOpenCreateModal} type="button">
            <span>+</span> List Item
          </button>
        </div>
      </div>
    </header>
  );
};
