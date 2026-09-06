from fastapi import Header, HTTPException


# ponytail: dev-only bearer-token auth (token == user id), matching the frontend's
# dev stub login. Swap for verifying a real Firebase Auth / Identity Platform ID
# token before deployment — ownership must always come from the verified token,
# never from a client-supplied user id in the request body.
async def get_current_user_id(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return token
