"""
Lightweight, dependency-free conversation memory.

Keeps a rolling transcript of recent turns in memory and persists the full
history to a JSON file (data/memory.json) on disk, so Hiyori remembers her
boyfriend across sessions, page refreshes, and server restarts. No vector
database or heavy ML libraries are required, which keeps the Render build
small and the free-instance CPU happy.
"""
import json
import os
import threading
from collections import deque

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
MEMORY_FILE = os.path.join(DATA_DIR, "memory.json")

_SHORT_TERM_LIMIT = 12
_MAX_HISTORY = 200

_lock = threading.Lock()


def _load_history() -> list[str]:
    if os.path.exists(MEMORY_FILE):
        try:
            with open(MEMORY_FILE, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            turns = data.get("turns", [])
            return [t for t in turns if isinstance(t, str)][-_MAX_HISTORY:]
        except Exception:
            pass
    return []


def _save_history(history: list[str]) -> None:
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(MEMORY_FILE, "w", encoding="utf-8") as fh:
            json.dump({"turns": history}, fh)
    except Exception:
        pass


class ConversationMemory:
    """In-process conversation memory backed by a persistent JSON file."""

    def __init__(self, session_id: str | None = None):
        self.session_id = session_id or "default_session"
        with _lock:
            self.history = _load_history()
        self.recent_turns: deque[str] = deque(maxlen=_SHORT_TERM_LIMIT)

    def add_turn(self, user_text: str, hiyori_text: str) -> None:
        if not user_text and not hiyori_text:
            return
        doc = f"Boyfriend: {user_text}\nHiyori: {hiyori_text}"
        with _lock:
            self.history.append(doc)
            if len(self.history) > _MAX_HISTORY:
                self.history = self.history[-_MAX_HISTORY:]
            _save_history(self.history)
        self.recent_turns.append(doc)

    def build_context(self, current_user_text: str) -> str:
        """Combine recent conversation turns with relevant past memories."""
        relevant = [
            t for t in self.history
            if t not in self.recent_turns and current_user_text.lower() in t.lower()
        ][-6:]

        parts = []
        if relevant:
            parts.append("Related past memories:\n" + "\n---\n".join(relevant))
        if self.recent_turns:
            parts.append("Recent conversation history:\n" + "\n---\n".join(self.recent_turns))
        return "\n\n".join(parts)
