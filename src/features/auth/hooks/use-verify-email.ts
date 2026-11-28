import { useEffect, useState } from "react";

interface UseVerifyEmailOptions {
  error: string | undefined;
}

export function useVerifyEmail(options: UseVerifyEmailOptions) {
  const { error } = options;

  const [status, setStatus] = useState<"ANALYZING" | "SUCCESS" | "ERROR">(
    "ANALYZING",
  );

  useEffect(() => {
    let cancelled = false;
    const analyzeSignal = async () => {
      // A short pause covers the redirect that follows the verification link.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (!cancelled) {
        setStatus(error ? "ERROR" : "SUCCESS");
      }
    };

    void analyzeSignal();
    return () => {
      cancelled = true;
    };
  }, [error]);

  return { status };
}
