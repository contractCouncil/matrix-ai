"use client";

import React, { createContext, useContext, ReactNode } from "react";

interface User {
    id: string;
    email: string;
}

interface AuthContextType {
    user: User | null;
    isAuthenticated: boolean;
    authLoading: boolean;
    signOut: () => Promise<void>;
}

const MOCK_USER: User = {
    id: "00000000-0000-0000-0000-000000000001",
    email: "dev@local.test",
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const signOut = async () => {};

    return (
        <AuthContext.Provider
            value={{
                user: MOCK_USER,
                isAuthenticated: true,
                authLoading: false,
                signOut,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
