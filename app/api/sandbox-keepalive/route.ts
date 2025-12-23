import { NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';

declare global {
  var activeSandboxProvider: any;
  var sandboxData: any;
}

export async function POST() {
  try {
    const provider = sandboxManager.getActiveProvider() || global.activeSandboxProvider;
    
    if (!provider) {
      return NextResponse.json({
        success: false,
        message: 'No active sandbox to keep alive'
      }, { status: 404 });
    }

    try {
      // Perform a simple health check by trying to get sandbox info
      const sandboxInfo = provider.getSandboxInfo();
      
      if (!sandboxInfo) {
        throw new Error('Sandbox info unavailable');
      }

      // Check if Vite is running on the port
      let viteRunning = false;
      if (provider.runCommand) {
        try {
          // Check if Vite process is running
          const checkVite = await provider.runCommand('pgrep -f "vite" || echo "not_running"');
          const viteOutput = typeof checkVite.stdout === 'function' ? await checkVite.stdout() : checkVite.stdout || '';
          viteRunning = !viteOutput.includes('not_running') && viteOutput.trim().length > 0;
          
          console.log('[sandbox-keepalive] Vite status:', viteRunning ? 'running' : 'not running');
          
          // If Vite is not running, try to start it
          if (!viteRunning) {
            console.log('[sandbox-keepalive] Vite not running, attempting to start...');
            await provider.runCommand('sh -c "cd /home/user/app && nohup npm run dev > /tmp/vite.log 2>&1 &"');
            
            // Wait a moment for Vite to start
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Check again
            const recheckVite = await provider.runCommand('pgrep -f "vite" || echo "not_running"');
            const recheckOutput = typeof recheckVite.stdout === 'function' ? await recheckVite.stdout() : recheckVite.stdout || '';
            viteRunning = !recheckOutput.includes('not_running') && recheckOutput.trim().length > 0;
            
            if (!viteRunning) {
              throw new Error('Failed to start Vite server');
            }
            
            console.log('[sandbox-keepalive] Vite successfully restarted');
          }
        } catch (cmdError) {
          console.error('[sandbox-keepalive] Vite check/restart failed:', cmdError);
          throw new Error(`Vite health check failed: ${(cmdError as Error).message}`);
        }
      }

      return NextResponse.json({
        success: true,
        message: 'Sandbox and Vite are healthy',
        sandboxId: sandboxInfo.sandboxId,
        viteRunning,
        timestamp: new Date().toISOString()
      });

    } catch (healthError) {
      console.error('[sandbox-keepalive] Health check failed:', healthError);
      
      return NextResponse.json({
        success: false,
        message: 'Sandbox unhealthy',
        error: (healthError as Error).message,
        shouldRecreate: true
      }, { status: 410 });
    }

  } catch (error) {
    console.error('[sandbox-keepalive] Error:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}

