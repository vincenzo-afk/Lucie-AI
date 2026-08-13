"""
Maps an emotion label (from the LLM's JSON reply) to a full set of Live2D
Cubism parameter targets for the LucieSD3 model. Always starts from the
neutral pose and overlays the emotion-specific deltas, so every response
is a complete, well-formed parameter set (never partial).
"""
from backend import config


def get_live2d_params(emotion: str) -> dict[str, float]:
    if emotion not in config.EMOTION_PARAMS:
        emotion = "neutral"

    params = dict(config.EMOTION_PARAMS["neutral"])
    params.update(config.EMOTION_PARAMS[emotion])
    return params
