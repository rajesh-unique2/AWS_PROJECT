import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "south-indian-jewelry-secret-key-2024")
    MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/south_indian_jewelry")
    SESSION_TYPE = "filesystem"
    DEBUG = True
