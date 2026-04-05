export interface ApiSuccess<T> {
    success: true;
    data: T;
}
export interface ApiError {
    success: false;
    error: {
        code: string;
        message: string;
    };
}
export interface ApiPaginated<T> {
    success: true;
    data: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
    };
}
export type ApiResponse<T> = ApiSuccess<T> | ApiError;
export type ApiPaginatedResponse<T> = ApiPaginated<T> | ApiError;
//# sourceMappingURL=api.d.ts.map