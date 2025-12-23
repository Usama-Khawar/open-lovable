import { sandboxManager } from "@/lib/sandbox/sandbox-manager";
import { NextResponse } from "next/server";

declare global {
  var activeSandboxProvider: any;
}

export async function GET() {
  try {
    const provider =
      sandboxManager.getActiveProvider() || global.activeSandboxProvider;

    if (!provider) {
      return NextResponse.json(
        { success: false, error: "No active sandbox" },
        { status: 404 }
      );
    }

    const diagnostics: any = {
      timestamp: new Date().toISOString(),
      checks: {},
    };

    // Check 1: Vite process
    try {
      const viteCheck = await provider.runCommand(
        'pgrep -f "vite" || echo "not_running"'
      );
      const viteOutput =
        typeof viteCheck.stdout === "function"
          ? await viteCheck.stdout()
          : viteCheck.stdout || "";
      diagnostics.checks.viteProcess = {
        running:
          !viteOutput.includes("not_running") && viteOutput.trim().length > 0,
        pid: viteOutput.trim() || null,
      };
    } catch (e) {
      diagnostics.checks.viteProcess = { error: (e as Error).message };
    }

    // Check 2: Vite logs
    try {
      const logsCheck = await provider.runCommand(
        'tail -n 50 /tmp/vite.log 2>/dev/null || echo "no logs"'
      );
      const logs =
        typeof logsCheck.stdout === "function"
          ? await logsCheck.stdout()
          : logsCheck.stdout || "";
      diagnostics.checks.viteLogs = logs;

      // Parse for errors
      const hasErrors =
        logs.includes("error") ||
        logs.includes("Error") ||
        logs.includes("EADDRINUSE");
      diagnostics.checks.viteLogsHasErrors = hasErrors;
    } catch (e) {
      diagnostics.checks.viteLogs = { error: (e as Error).message };
    }

    // Check 3: Port status
    try {
      const portCheck = await provider.runCommand(
        'lsof -i :5173 2>/dev/null || echo "port_free"'
      );
      const portOutput =
        typeof portCheck.stdout === "function"
          ? await portCheck.stdout()
          : portCheck.stdout || "";
      diagnostics.checks.port5173 = {
        inUse: !portOutput.includes("port_free"),
        details: portOutput.substring(0, 200),
      };
    } catch (e) {
      diagnostics.checks.port5173 = { error: (e as Error).message };
    }

    // Check 4: Package.json exists
    try {
      const sandboxInfo = provider.getSandboxInfo();
      const workDir =
        sandboxInfo?.provider === "vercel"
          ? "/vercel/sandbox"
          : "/home/user/app";

      const pkgCheck = await provider.runCommand(
        `test -f ${workDir}/package.json && echo "exists" || echo "missing"`
      );
      const pkgOutput =
        typeof pkgCheck.stdout === "function"
          ? await pkgCheck.stdout()
          : pkgCheck.stdout || "";
      diagnostics.checks.packageJson = {
        exists: pkgOutput.includes("exists"),
        path: `${workDir}/package.json`,
      };

      // Read package.json content
      if (pkgOutput.includes("exists")) {
        const catCheck = await provider.runCommand(
          `cat ${workDir}/package.json`
        );
        const content =
          typeof catCheck.stdout === "function"
            ? await catCheck.stdout()
            : catCheck.stdout || "";
        try {
          const pkg = JSON.parse(content);
          diagnostics.checks.packageJsonContent = {
            valid: true,
            hasVite: !!pkg.devDependencies?.vite,
            hasReact: !!pkg.dependencies?.react,
            scripts: pkg.scripts || {},
          };
        } catch (parseErr) {
          diagnostics.checks.packageJsonContent = {
            valid: false,
            error: "Invalid JSON",
          };
        }
      }
    } catch (e) {
      diagnostics.checks.packageJson = { error: (e as Error).message };
    }

    // Check 5: Node modules installed
    try {
      const sandboxInfo = provider.getSandboxInfo();
      const workDir =
        sandboxInfo?.provider === "vercel"
          ? "/vercel/sandbox"
          : "/home/user/app";

      const nmCheck = await provider.runCommand(
        `test -d ${workDir}/node_modules && echo "exists" || echo "missing"`
      );
      const nmOutput =
        typeof nmCheck.stdout === "function"
          ? await nmCheck.stdout()
          : nmCheck.stdout || "";
      diagnostics.checks.nodeModules = {
        exists: nmOutput.includes("exists"),
        path: `${workDir}/node_modules`,
      };
    } catch (e) {
      diagnostics.checks.nodeModules = { error: (e as Error).message };
    }

    // Check 6: Disk space
    try {
      const dfCheck = await provider.runCommand("df -h / | tail -1");
      const dfOutput =
        typeof dfCheck.stdout === "function"
          ? await dfCheck.stdout()
          : dfCheck.stdout || "";
      diagnostics.checks.diskSpace = dfOutput.trim();
    } catch (e) {
      diagnostics.checks.diskSpace = { error: (e as Error).message };
    }

    // Provide recommendations
    diagnostics.recommendations = [];

    if (!diagnostics.checks.viteProcess?.running) {
      diagnostics.recommendations.push(
        "Vite process is not running. Use /api/sandbox-keepalive to restart it."
      );
    }

    if (diagnostics.checks.viteLogsHasErrors) {
      diagnostics.recommendations.push(
        "Vite logs contain errors. Check the viteLogs field for details."
      );
    }

    if (
      diagnostics.checks.port5173?.inUse &&
      !diagnostics.checks.viteProcess?.running
    ) {
      diagnostics.recommendations.push(
        "Port 5173 is in use but Vite is not running. Kill the process using the port."
      );
    }

    if (!diagnostics.checks.packageJson?.exists) {
      diagnostics.recommendations.push(
        "package.json is missing. Recreate the sandbox."
      );
    }

    if (!diagnostics.checks.packageJsonContent?.valid) {
      diagnostics.recommendations.push(
        "package.json is invalid. Recreate the sandbox."
      );
    }

    if (!diagnostics.checks.nodeModules?.exists) {
      diagnostics.recommendations.push(
        "node_modules is missing. Run npm install."
      );
    }

    return NextResponse.json({
      success: true,
      diagnostics,
    });
  } catch (error) {
    console.error("[diagnose-vite] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
