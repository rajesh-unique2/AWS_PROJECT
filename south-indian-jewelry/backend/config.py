import os
from urllib.parse import quote, unquote, urlsplit, urlunsplit
from dotenv import load_dotenv

load_dotenv()

def normalize_mongo_uri(raw_uri: str) -> str:
    uri = (raw_uri or "").strip()
    if not uri:
        return ""

    parsed = urlsplit(uri)
    if parsed.scheme not in {"mongodb", "mongodb+srv"}:
        return uri

    if "@" not in parsed.netloc:
        return uri

    credentials, host_part = parsed.netloc.rsplit("@", 1)
    if ":" not in credentials:
        return uri

    username, password = credentials.split(":", 1)
    encoded_username = quote(unquote(username), safe="")
    encoded_password = quote(unquote(password), safe="")
    normalized_netloc = f"{encoded_username}:{encoded_password}@{host_part}"
    normalized = parsed._replace(netloc=normalized_netloc)
    return urlunsplit(normalized)


mongo_uri = normalize_mongo_uri(os.getenv("MONGO_URI", ""))
if not mongo_uri:
    raise ValueError("MONGO_URI is required. Set your MongoDB Atlas connection string in backend/.env")

class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "south-indian-jewelry-secret-key-2024")
    MONGO_URI = mongo_uri
    SESSION_TYPE = "filesystem"
    DEBUG = True
