import os
from dotenv import load_dotenv

load_dotenv()

mongo_uri = os.getenv("MONGO_URI", "").strip()
if not mongo_uri:
    raise ValueError("MONGO_URI is required. Set your MongoDB Atlas connection string in backend/.env")

class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "south-indian-jewelry-secret-key-2024")
    MONGO_URI = mongo_uri
    SESSION_TYPE = "filesystem"
    DEBUG = True
