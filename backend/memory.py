"""
Lightweight conversation memory using an in-memory ChromaDB collection.
Each turn (user message + Lucie's reply) is stored as one document so the
embedding captures the whole exchange. On every new turn we pull back the
top-N most similar past exchanges to give Gemini long-term context, plus
we keep the last few turns verbatim for short-term continuity.
"""
import time
import uuid

import chromadb
from chromadb.utils import embedding_functions

_client = chromadb.EphemeralClient()  # in-memory only, no persistence file for v1
_embedder = embedding_functions.SentenceTransformerEmbeddingFunction(
    model_name="all-MiniLM-L6-v2"
)

_SHORT_TERM_LIMIT = 5
_SIMILAR_TOP_K = 3


class ConversationMemory:
    """One instance per WebSocket connection (i.e. per chat session)."""

    def __init__(self, session_id: str | None = None):
        self.session_id = session_id or str(uuid.uuid4())
        self.collection = _client.get_or_create_collection(
            name=f"lucie_memory_{self.session_id}",
            embedding_function=_embedder,
        )
        self.recent_turns: list[str] = []

    def add_turn(self, user_text: str, lucie_text: str) -> None:
        doc = f"Boyfriend: {user_text}\nLucie: {lucie_text}"
        self.collection.add(
            documents=[doc],
            ids=[str(uuid.uuid4())],
            metadatas=[{"ts": time.time()}],
        )
        self.recent_turns.append(doc)
        if len(self.recent_turns) > _SHORT_TERM_LIMIT:
            self.recent_turns.pop(0)

    def build_context(self, current_user_text: str) -> str:
        """Combine recent turns (verbatim) with similar past turns (semantic recall)."""
        count = self.collection.count()
        similar: list[str] = []
        if count > 0 and current_user_text:
            k = min(_SIMILAR_TOP_K, count)
            results = self.collection.query(query_texts=[current_user_text], n_results=k)
            docs = results.get("documents", [[]])[0]
            similar = [d for d in docs if d not in self.recent_turns]

        parts = []
        if similar:
            parts.append("Similar past moments:\n" + "\n---\n".join(similar))
        if self.recent_turns:
            parts.append("Most recent turns:\n" + "\n---\n".join(self.recent_turns))
        return "\n\n".join(parts)
