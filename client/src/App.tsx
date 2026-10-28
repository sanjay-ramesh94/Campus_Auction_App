import { useState, useEffect, useCallback } from 'react';
import type { Auction, UserPersona, ToastMessage } from './types';
import { Header } from './components/Header';
import { AuctionCard } from './components/AuctionCard';
import { BiddingConsole } from './components/BiddingConsole';
import { CreateAuctionModal } from './components/CreateAuctionModal';
import { Toast } from './components/Toast';

const PERSONAS: UserPersona[] = [
  { id: '6ae17eacf4fba89e771f4f14', name: 'Bob', role: 'Manual', avatar: '👤' },
  { id: '6ae17eacf4fba89e771f4f15', name: 'Charlie', role: 'Manual', avatar: '👤' },
  { id: '6ae17eacf4fba89e771f4f16', name: 'David', role: 'Sniper', avatar: '👤' },
  { id: '6ae17eacf4fba89e771f4f13', name: 'Alice', role: 'Auto-Bidder', avatar: '🤖' },
];

export function App() {
  const [personas] = useState<UserPersona[]>(PERSONAS);
  const [selectedPersona, setSelectedPersona] = useState<UserPersona>(PERSONAS[0]);
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [selectedAuctionId, setSelectedAuctionId] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean>(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);

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

  const fetchAuctions = useCallback(async () => {
    try {
      const res = await fetch('/api/auctions');
      const data = await res.json();
      if (data.ok && Array.isArray(data.auctions)) {
        setAuctions(data.auctions);
        setSelectedAuctionId((currentId) => {
          if (!currentId && data.auctions.length > 0) {
            return data.auctions[0]._id;
          }
          return currentId;
        });
      }
    } catch (err) {
      console.error('Failed to fetch auctions:', err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchAuctions();
  }, [fetchAuctions]);

  // Connect to live SSE Stream
  useEffect(() => {
    const eventSource = new EventSource('/api/events');

    eventSource.onopen = () => {
      setConnected(true);
    };

    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'CONNECTED') return;

        // Auto-refresh auctions on any transactional state change
        fetchAuctions();

        // Dispatch relevant toast notifications based on target user
        if (event.type === 'DEADLINE_EXTENDED') {
          showToast('warning', '🛡️ Anti-Sniping Protection', 'A bid landed in the final 30s! Deadline extended by +60s.');
        } else if (event.type === 'OUTBID') {
          if (event.targetUserId === selectedPersona.id) {
            showToast('error', '⚠️ You were Outbid!', `Someone placed a higher bid (₹${event.payload?.newPrice}).`);
          }
        } else if (event.type === 'AUTO_BID_TRIGGERED') {
          if (event.targetUserId === selectedPersona.id) {
            showToast('info', '🤖 Auto-Bid Activated', `Your proxy auto-bid placed ₹${event.payload?.amount} for you.`);
          }
        }
      } catch (err) {
        console.error('SSE message parsing error:', err);
      }
    };

    eventSource.onerror = () => {
      setConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, [fetchAuctions, selectedPersona.id, showToast]);

  const selectedAuction = auctions.find((a) => a._id === selectedAuctionId) || null;

  return (
    <div className="app-container">
      {/* Header */}
      <Header
        connected={connected}
        personas={personas}
        selectedPersona={selectedPersona}
        onSelectPersona={setSelectedPersona}
        onOpenCreateModal={() => setIsCreateOpen(true)}
      />

      {/* Architecture Highlights Bar */}
      <div className="info-banner">
        <div className="banner-card">
          <div className="banner-left">
            <span className="badge-tech">MongoDB Transactions</span>
            <span>
              Real-time multi-document ACID consistency. Zero float drift (Integer ₹). Anti-sniping +60s extensions. In-transaction proxy auto-bid resolution.
            </span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: '#10b981', fontWeight: 600 }}>
              {auctions.length} Active Listing{auctions.length === 1 ? '' : 's'}
            </span>
            <button className="btn btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }} onClick={fetchAuctions}>
              🔄 Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <main className="main-content">
        {/* Left: Catalog */}
        <section className="catalog-section">
          <div className="catalog-header">
            <h2 className="section-heading">Live Campus Listings</h2>
          </div>

          <div className="catalog-cards">
            {auctions.length === 0 ? (
              <div className="auction-card" style={{ textAlign: 'center', color: '#94a3b8' }}>
                No active listings found. Click "+ List Item" to add one!
              </div>
            ) : (
              auctions.map((item) => (
                <AuctionCard
                  key={item._id}
                  auction={item}
                  isSelected={item._id === selectedAuctionId}
                  currentPersona={selectedPersona}
                  onSelect={(a) => setSelectedAuctionId(a._id)}
                />
              ))
            )}
          </div>
        </section>

        {/* Right: Bidding Console */}
        <section className="workspace-section">
          <BiddingConsole
            auction={selectedAuction}
            currentPersona={selectedPersona}
            onBidPlaced={fetchAuctions}
            showToast={showToast}
          />
        </section>
      </main>

      {/* Create Listing Modal */}
      <CreateAuctionModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        currentPersona={selectedPersona}
        onCreated={fetchAuctions}
        showToast={showToast}
      />

      {/* Toast Notifications */}
      <Toast toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </div>
  );
}

export default App;
