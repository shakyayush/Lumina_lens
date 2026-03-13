from pydantic import BaseModel
from typing import Optional

class QuestionRequest(BaseModel):
    user_id: str
    text: str

class QuestionResponse(BaseModel):
    status: str          # "unique" | "duplicate" | "limit_reached"
    message: str
    points_earned: int
    total_points: int
    tier: str
    similarity_score: Optional[float] = None

class RedeemRequest(BaseModel):
    tier: str            # "pro" | "enterprise"

class RedeemResponse(BaseModel):
    success: bool
    message: str
    new_tier: str
    remaining_points: int

class Question(BaseModel):
    id: str
    user_id: str
    text: str
    timestamp: str
    priority: str        # "normal" | "priority"
    starred: bool = False

class StarQuestionRequest(BaseModel):
    question_id: str


class AIModeRequest(BaseModel):
    enabled: bool


class MultimodalContextRequest(BaseModel):
    transcript: Optional[str] = None
    frame_data_url: Optional[str] = None
    frame_rate: Optional[float] = None


class RtcTokenRequest(BaseModel):
    role: str  # "host" | "audience"
    user_id: Optional[str] = None


class RtcTokenResponse(BaseModel):
    token: str
    ws_url: str
    room_name: str
    identity: str
    role: str
