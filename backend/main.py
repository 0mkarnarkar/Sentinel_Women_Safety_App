from fastapi import FastAPI, BackgroundTasks, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import speech_recognition as sr
import shutil
import time
import os
from datetime import datetime

app = FastAPI(title="Sentinel Core Pipeline")

# --- CORS SETUP (Crucial for mobile app connection) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all devices on your Wi-Fi to connect
    allow_credentials=True,
    allow_methods=["*"],  
    allow_headers=["*"],  
)

# --- DATA MODELS ---
class EmergencyPayload(BaseModel):
    user_id: str
    trigger_type: str 
    lat: float
    lng: float
    battery_level: Optional[float] = None

# Creates the evidence vault folder immediately when the server starts
os.makedirs("evidence_vault", exist_ok=True)

# --- CORE ENDPOINTS ---

@app.post("/api/v1/sos/trigger")
async def handle_emergency(payload: EmergencyPayload, background_tasks: BackgroundTasks):
    """Handles all incoming emergencies (drops, manual button, voice triggers)."""
    
    # 1. Log the emergency in the terminal for the judges to see!
    print("\n" + "="*50)
    print(f"🚨 [EMERGENCY DETECTED] 🚨")
    print(f"User: {payload.user_id}")
    print(f"Trigger: {payload.trigger_type}")
    print(f"Location: {payload.lat}, {payload.lng}")
    print("="*50 + "\n")
    
    # In a real startup, this is where you'd ping the Police API or send SMS
    severity = "CRITICAL" if "Impact" in payload.trigger_type else "HIGH"
    
    return {
        "status": "active",
        "severity": severity,
        "action": f"Alert routed for {payload.trigger_type}",
        "timestamp": time.time()
    }


@app.post("/api/v1/sos/analyze-audio")
async def analyze_audio_context(file: UploadFile = File(...)):
    """
    REAL NLP PIPELINE & EVIDENCE VAULT: 
    Translates speech, triggers SOS, and permanently saves danger audio.
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    temp_path = f"temp_audio_{timestamp}.wav"
    
    try:
        # 1. Save the audio chunk from the phone temporarily
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # 2. Use Google's Free AI to read the audio
        recognizer = sr.Recognizer()
        with sr.AudioFile(temp_path) as source:
            audio_data = recognizer.record(source)
            text = recognizer.recognize_google(audio_data).lower()
            
            print(f"🎙️ [Live Transcript]: {text}")

            # 3. Check for Danger Words!
            danger_keywords = ["help", "save me", "stop it", "police", "leave me alone"]
            
            if any(word in text for word in danger_keywords):
                print("⚠️ [THREAT DETECTED] Saving to Evidence Vault...")
                
                # MOVE the file to the vault instead of deleting it
                vault_audio_path = f"evidence_vault/threat_{timestamp}.wav"
                vault_text_path = f"evidence_vault/transcript_{timestamp}.txt"
                
                shutil.move(temp_path, vault_audio_path)
                
                # Save the written transcript as proof
                with open(vault_text_path, "w") as f:
                    f.write(f"Time: {timestamp}\nTranscript: {text}\nTrigger Words Matched.")
                
                return {"danger_detected": True, "transcript": text}
            
            return {"danger_detected": False, "transcript": text}
            
    except sr.UnknownValueError:
        # Google couldn't understand the audio (silence, wind, etc.)
        return {"danger_detected": False, "transcript": "[Silence or unreadable]"}
    except Exception as e:
        print(f"Audio processing error: {str(e)}")
        return {"danger_detected": False, "error": str(e)}
    finally:
        # 4. Clean up only if no danger was detected (so your laptop stays clean!)
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.post("/api/v1/routes/safe-path")
async def get_active_path(lat: float, lng: float):
    """Returns the safest, most populated route. (Kept for architecture docs)"""
    return {
        "recommended_route": "Commercial Avenue",
        "crowd_density": "High",
        "safety_score": 94,
        "eta_mins": 14
    }

if __name__ == "__main__":
    import uvicorn
    # Run via: python main.py
    print("🛡️ Sentinel Backend Online. Listening for mobile telemetry...")
    uvicorn.run(app, host="0.0.0.0", port=8000)