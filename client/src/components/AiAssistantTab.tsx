import React, { useState } from 'react';
import type { ProposalCard } from '../types';

interface AiAssistantTabProps {
  token: string;
  showToast: (type: 'info' | 'success' | 'warning' | 'error', title: string, message: string) => void;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  proposal?: ProposalCard;
}

export const AiAssistantTab: React.FC<AiAssistantTabProps> = ({ token, showToast }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init-1',
      sender: 'assistant',
      text: "👋 Hi! I'm your CampusBid AI Assistant. Ask me to find deals, compare items, or prepare a smart bid proposal. When I propose a bid, you'll see a confirm card—nothing runs until you tap Confirm!",
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [biddingAuctionId, setBiddingAuctionId] = useState<string | null>(null);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userText = input.trim();
    setInput('');
    const userMsg: ChatMessage = { id: String(Date.now()), sender: 'user', text: userText };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: userText }),
      });

      const data = await res.json();
      if (data.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: String(Date.now() + 1),
            sender: 'assistant',
            text: data.reply,
            proposal: data.proposalCard,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: String(Date.now() + 1),
            sender: 'assistant',
            text: "Sorry, I couldn't reach the engine. Please try again.",
          },
        ]);
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmBid = async (card: ProposalCard) => {
    setBiddingAuctionId(card.auctionId);
    try {
      const res = await fetch('/api/bids', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          auctionId: card.auctionId,
          amount: card.recommendedBid,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        showToast('success', 'Bid Placed!', `Successfully bid ₹${card.recommendedBid} on "${card.itemTitle}"`);
        setMessages((prev) => [
          ...prev,
          {
            id: String(Date.now()),
            sender: 'assistant',
            text: `🎉 Confirmed! Your bid of ₹${card.recommendedBid} has been recorded in the database.`,
          },
        ]);
      } else {
        showToast('error', 'Bid Rejected', data.error || data.reason || 'Could not place bid');
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    } finally {
      setBiddingAuctionId(null);
    }
  };

  return (
    <div className="ai-assistant-layout">
      <div className="tab-header-box">
        <h2>✨ CampusBid AI Assistant</h2>
        <p>Ask for item recommendations or bid strategies. Bids are proposed as confirm cards—safe and non-destructive.</p>
      </div>

      <div className="chat-container">
        <div className="chat-messages">
          {messages.map((m) => (
            <div key={m.id} className={`chat-bubble-row ${m.sender}`}>
              <div className="chat-avatar">{m.sender === 'assistant' ? '🤖' : '👤'}</div>
              <div className="chat-bubble">
                <p>{m.text}</p>

                {/* AI Proposal Card */}
                {m.proposal && (
                  <div className="ai-proposal-card">
                    <div className="proposal-badge">Proposed Action</div>
                    <h4>{m.proposal.itemTitle}</h4>
                    <div className="proposal-stats">
                      <div>
                        <span>Recommended Bid</span>
                        <strong>₹{m.proposal.recommendedBid.toLocaleString()}</strong>
                      </div>
                      <div>
                        <span>Buyout Cap</span>
                        <strong>₹{m.proposal.maxLimit.toLocaleString()}</strong>
                      </div>
                    </div>

                    <button
                      className="btn btn-action"
                      style={{ width: '100%', marginTop: '0.75rem', padding: '0.5rem' }}
                      disabled={biddingAuctionId === m.proposal.auctionId}
                      onClick={() => handleConfirmBid(m.proposal!)}
                    >
                      {biddingAuctionId === m.proposal.auctionId ? 'Placing Bid...' : `Confirm Bid ₹${m.proposal.recommendedBid}`}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="chat-bubble-row assistant">
              <div className="chat-avatar">🤖</div>
              <div className="chat-bubble loading">
                <span>Thinking...</span>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSend} className="chat-input-bar">
          <input
            type="text"
            className="chat-input"
            placeholder="Ask AI: 'Find me a good bicycle' or 'What should I bid on the keyboard?'"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={loading || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
};
