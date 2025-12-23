import { sandboxManager } from "@/lib/sandbox/sandbox-manager";
import { NextResponse } from "next/server";

declare global {
  var activeSandboxProvider: any;
  var sandboxData: any;
}

export async function POST() {
  try {
    const provider =
      sandboxManager.getActiveProvider() || global.activeSandboxProvider;

    if (!provider) {
      return NextResponse.json(
        {
          success: false,
          message: "No active sandbox to keep alive",
        },
        { status: 404 }
      );
    }

    try {
      // Perform a simple health check by trying to get sandbox info
      const sandboxInfo = provider.getSandboxInfo();

      if (!sandboxInfo) {
        console.warn(
          "[sandbox-keepalive] Sandbox info unavailable, but not marking for recreation yet"
        );
        // Don't immediately mark for recreation - might be a temporary issue
        return NextResponse.json({
          success: false,
          message: "Sandbox info temporarily unavailable",
          shouldRecreate: false, // Don't recreate on first failure
        });
      }

      // Check if Vite is running on the port
      let viteRunning = false;
      let viteUrl = "";

      if (provider.runCommand) {
        try {
          // Check if Vite process is running
          const checkVite = await provider.runCommand(
            'pgrep -f "vite" || echo "not_running"'
          );
          const viteOutput =
            typeof checkVite.stdout === "function"
              ? await checkVite.stdout()
              : checkVite.stdout || "";
          viteRunning =
            !viteOutput.includes("not_running") && viteOutput.trim().length > 0;

          console.log(
            "[sandbox-keepalive] Vite status:",
            viteRunning ? "running" : "not running"
          );

          // If Vite is not running, try to start it
          if (!viteRunning) {
            console.log(
              "[sandbox-keepalive] Vite not running, attempting to start..."
            );

            // Determine correct working directory based on provider
            const workDir =
              sandboxInfo.provider === "vercel"
                ? "/vercel/sandbox"
                : "/home/user/app";

            // First, check if there are any zombie processes
            try {
              await provider.runCommand('pkill -9 -f "vite" || true');
              console.log(
                "[sandbox-keepalive] Cleaned up any zombie processes"
              );
              await new Promise((resolve) => setTimeout(resolve, 1000));
            } catch (e) {
              console.log("[sandbox-keepalive] Cleanup skipped");
            }

            // Clear old logs to get fresh output
            try {
              await provider.runCommand(
                'sh -c "rm -f /tmp/vite.log && touch /tmp/vite.log"'
              );
            } catch (e) {
              console.log("[sandbox-keepalive] Log clear skipped");
            }

            // Start Vite with a proper restart
            await provider.runCommand(
              `sh -c "cd ${workDir} && nohup npm run dev > /tmp/vite.log 2>&1 &"`
            );

            console.log(
              "[sandbox-keepalive] Vite start command issued, waiting for startup..."
            );

            // Wait and check multiple times (up to 10 seconds)
            let startupSuccess = false;
            for (let attempt = 0; attempt < 10; attempt++) {
              await new Promise((resolve) => setTimeout(resolve, 1000));

              // Check if process exists
              const recheckVite = await provider.runCommand(
                'pgrep -f "vite" || echo "not_running"'
              );
              const recheckOutput =
                typeof recheckVite.stdout === "function"
                  ? await recheckVite.stdout()
                  : recheckVite.stdout || "";

              const processExists =
                !recheckOutput.includes("not_running") &&
                recheckOutput.trim().length > 0;

              if (processExists) {
                // Also check logs to see if Vite is actually ready
                try {
                  const logsCheck = await provider.runCommand(
                    'tail -n 20 /tmp/vite.log 2>/dev/null || echo "no logs yet"'
                  );
                  const logs =
                    typeof logsCheck.stdout === "function"
                      ? await logsCheck.stdout()
                      : logsCheck.stdout || "";

                  console.log(
                    `[sandbox-keepalive] Vite startup check ${
                      attempt + 1
                    }/10: process=${processExists}, logs=${logs.substring(
                      0,
                      100
                    )}`
                  );

                  if (
                    logs.includes("ready in") ||
                    logs.includes("Local:") ||
                    logs.includes("➜")
                  ) {
                    startupSuccess = true;
                    viteRunning = true;
                    console.log(
                      "[sandbox-keepalive] ✓ Vite successfully restarted and ready!"
                    );
                    break;
                  } else if (
                    logs.includes("error") ||
                    logs.includes("Error") ||
                    logs.includes("EADDRINUSE")
                  ) {
                    console.error(
                      "[sandbox-keepalive] Vite startup error detected in logs:",
                      logs
                    );
                    break; // Don't keep trying if there's an error
                  }
                } catch (logError) {
                  console.log(
                    "[sandbox-keepalive] Could not check logs:",
                    (logError as Error).message
                  );
                }
              }
            }

            if (!startupSuccess) {
              // Get final logs for debugging
              try {
                const finalLogs = await provider.runCommand(
                  'tail -n 50 /tmp/vite.log 2>/dev/null || echo "no logs"'
                );
                const logsOutput =
                  typeof finalLogs.stdout === "function"
                    ? await finalLogs.stdout()
                    : finalLogs.stdout || "";
                console.error(
                  "[sandbox-keepalive] Vite failed to start. Logs:",
                  logsOutput
                );
              } catch (e) {
                console.error(
                  "[sandbox-keepalive] Could not retrieve Vite logs"
                );
              }

              // Don't throw - just return status indicating Vite isn't running
              // The next keepalive will try again
              console.warn(
                "[sandbox-keepalive] Vite restart incomplete, will retry on next keepalive"
              );
            }
          }

          // Generate traffic to prevent idle timeout (critical for Vercel sandboxes)
          if (sandboxInfo.url) {
            try {
              // Make a request to the sandbox to keep it alive
              // Try multiple times to ensure we generate traffic
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 5000);

              await fetch(sandboxInfo.url, {
                method: "GET", // Use GET instead of HEAD for better compatibility
                signal: controller.signal,
                headers: {
                  "Cache-Control": "no-cache",
                },
              }).catch((fetchError) => {
                console.log(
                  "[sandbox-keepalive] Traffic generation fetch error (expected):",
                  fetchError.message
                );
                // Ignore errors - we're just generating traffic to prevent idle timeout
              });

              clearTimeout(timeoutId);
              console.log(
                "[sandbox-keepalive] Generated traffic to prevent idle timeout (URL ping successful)"
              );
            } catch (e) {
              // Ignore traffic generation errors
              console.log(
                "[sandbox-keepalive] Traffic generation error (non-critical):",
                (e as Error).message
              );
            }
          }
        } catch (cmdError) {
          console.error(
            "[sandbox-keepalive] Vite check/restart failed:",
            cmdError
          );

          // Try to get diagnostic info
          let diagnosticInfo = "";
          try {
            const psCheck = await provider.runCommand(
              'ps aux | grep -i vite || echo "no vite process"'
            );
            const psOutput =
              typeof psCheck.stdout === "function"
                ? await psCheck.stdout()
                : psCheck.stdout || "";
            diagnosticInfo += `Process check: ${psOutput.substring(0, 200)}\n`;

            const portCheck = await provider.runCommand(
              'lsof -i :5173 || echo "port not in use"'
            );
            const portOutput =
              typeof portCheck.stdout === "function"
                ? await portCheck.stdout()
                : portCheck.stdout || "";
            diagnosticInfo += `Port check: ${portOutput.substring(0, 200)}`;

            console.log("[sandbox-keepalive] Diagnostics:", diagnosticInfo);
          } catch (diagError) {
            console.log("[sandbox-keepalive] Could not get diagnostics");
          }

          // Don't immediately trigger recreation - Vite might recover on next ping
          return NextResponse.json({
            success: false,
            message: "Vite health check failed, but sandbox still alive",
            sandboxId: sandboxInfo.sandboxId,
            viteRunning: false,
            error: (cmdError as Error).message,
            diagnostics: diagnosticInfo,
            shouldRecreate: false, // Don't recreate, just report the issue
            timestamp: new Date().toISOString(),
          });
        }
      }

      return NextResponse.json({
        success: true,
        message: "Sandbox and Vite are healthy",
        sandboxId: sandboxInfo.sandboxId,
        viteRunning,
        timestamp: new Date().toISOString(),
      });
    } catch (healthError) {
      console.error("[sandbox-keepalive] Health check failed:", healthError);

      // Only mark for recreation if it's a critical error
      const errorMessage = (healthError as Error).message;
      const isCritical =
        errorMessage.includes("No active sandbox") ||
        errorMessage.includes("terminated") ||
        errorMessage.includes("stopped");

      return NextResponse.json(
        {
          success: false,
          message: "Sandbox health check failed",
          error: errorMessage,
          shouldRecreate: isCritical, // Only recreate for critical errors
        },
        { status: isCritical ? 410 : 503 }
      );
    }
  } catch (error) {
    console.error("[sandbox-keepalive] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
