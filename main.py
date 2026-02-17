from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from auth_module.auth_routes import auth_router

app = FastAPI(title="Echo Tutor Auth API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/auth", tags=["Auth"])


@app.get("/")
def root():
    return {"status": "ok", "service": "auth"}
