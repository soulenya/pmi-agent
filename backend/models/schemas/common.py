"""Standard Pydantic response envelope and pagination models."""

from __future__ import annotations

from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class Meta(BaseModel):
    page: int = 1
    page_size: int = 25
    total: int = 0
    total_pages: int = 0


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class ApiResponse(BaseModel, Generic[T]):
    success: bool
    data: T | None = None
    meta: Meta | None = None
    error: ErrorDetail | None = None

    @classmethod
    def ok(cls, data: T, meta: Meta | None = None) -> "ApiResponse[T]":
        return cls(success=True, data=data, meta=meta)

    @classmethod
    def fail(cls, code: str, message: str, details: dict | None = None) -> "ApiResponse[None]":
        return cls(
            success=False,
            data=None,
            error=ErrorDetail(code=code, message=message, details=details or {}),
        )


class MessageResponse(BaseModel):
    message: str


class PaginationParams(BaseModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=25, ge=1, le=100)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size
