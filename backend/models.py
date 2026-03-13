from pydantic import BaseModel, Field
from typing import Optional


class QuestionRequest(BaseModel):
    user_id: str = Field(..., description="Unique attendee identifier", example="attendee_abc")
    text: str = Field(
        ...,
        min_length=5,
        max_length=500,
        description="The question text from the attendee",
        example="What is the project submission deadline?",
    )


class QuestionResponse(BaseModel):
    status: str           # "unique" | "duplicate" | "limit_reached" | "context_answered"
    message: str
    points_earned: int
    total_points: int
    tier: str
    similarity_score: Optional[float] = None


class RedeemRequest(BaseModel):
    tier: str = Field(..., description="Target tier to redeem points for: 'pro' or 'enterprise'")


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
    priority: str   # "normal" | "priority"
    starred: bool = False


class StarQuestionRequest(BaseModel):
    question_id: str = Field(..., description="The ID of the question to star")
    host_token: str = Field(..., description="Secret token issued to the host at session start")


class AIModeRequest(BaseModel):
    enabled: bool


class MultimodalContextRequest(BaseModel):
    transcript: Optional[str] = Field(None, description="Live audio transcript snippet")
    frame_data_url: Optional[str] = Field(None, description="Base64 data URL of a video frame snapshot")
    frame_rate: Optional[float] = Field(None, description="Current video stream frame-rate in fps")


class RtcTokenRequest(BaseModel):
    role: str = Field(..., description="'host' or 'audience'")
    user_id: Optional[str] = Field(None, description="Existing user ID (audience only)")


class RtcTokenResponse(BaseModel):
    token: str
    ws_url: str
    room_name: str
    identity: str
    role: str


class SessionMetadataRequest(BaseModel):
    host_name: Optional[str] = Field(None, description="Name of the meeting host", example="Alice Johnson")
    meeting_topic: Optional[str] = Field(None, description="Topic or agenda of the meeting", example="Q3 Roadmap Review")
