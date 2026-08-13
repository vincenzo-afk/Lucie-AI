"""
Persistent long-term memory for Hiyori AI Girlfriend using ChromaDB PersistentClient.
Stores every exchange permanently in a local disk database (data/chroma_db) so she
remembers everything about her boyfriend across sessions, page refreshes, and server restarts.
"""
import os
import time
import uuid

import chromadb
from chromadb.utils import embedding_functions

# Store persistent vector database on disk
DB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "chroma_db")
os.makedirs(DB_DIR, exist_ok=True)

_client = chromadb.PersistentClient(path=DB_DIR)

# Prefer local SentenceTransformer embeddings when available; otherwise fall back
# to ChromaDB's default ONNX mini model so Render deployments (without torch)
# still get working semantic memory.
try:
    _embedder = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name="all-MiniLM-L6-v2"
    )
except Exception:
    _embedder = embedding_functions.DefaultEmbeddingFunction()

_SHORT_TERM_LIMIT = 10
_SIMILAR_TOP_K = 6


class ConversationMemory:
    """Persistent memory instance storing long-term memory for Hiyori's boyfriend."""

    def __init__(self, session_id: str | None = None):
        self.session_id = session_id or "default_boyfriend_session"
        self.collection = _client.get_or_create_collection(
            name="hiyori_girlfriend_persistent_memory",
            embedding_function=_embedder,
        )
        self.recent_turns: list[str] = []

    def add_turn(self, user_text: str, hiyori_text: str) -> None:
        if not user_text and not hiyori_text:
            return
        doc = f"Boyfriend: {user_text}\nHiyori: {hiyori_text}"
        self.collection.add(
            documents=[doc],
            ids=[str(uuid.uuid4())],
            metadatas=[{"ts": time.time(), "session": self.session_id}],
        )
        self.recent_turns.append(doc)
        if len(self.recent_turns) > _SHORT_TERM_LIMIT:
            self.recent_turns.pop(0)

    def build_context(self, current_user_text: str) -> str:
        """Combine recent conversation turns with top relevant semantic memories from disk."""
        count = self.collection.count()
        similar: list[str] = []
        if count > 0 and current_user_text:
            k = min(_SIMILAR_TOP_K, count)
            try:
                results = self.collection.query(query_texts=[current_user_text], n_results=k)
                docs = results.get("documents", [[]])[0]
                similar = [d for d in docs if d not in self.recent_turns]
            except Exception:
                similar = []

        parts = []
        if similar:
            parts.append("Shared past memories with your boyfriend:\n" + "\n---\n".join(similar))
        if self.recent_turns:
            parts.append("Recent conversation history:\n" + "\n---\n".join(self.recent_turns))
        return "\n\n".join(parts)
