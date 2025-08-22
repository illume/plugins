import { registerAppBarAction, runCommand } from '@kinvolk/headlamp-plugin/lib';
import { Button } from '@mui/material';

declare const pluginRunCommand: typeof runCommand;

registerAppBarAction(() => (
  <Button
    variant="contained"
    color="primary"
    onClick={() => {
      const p = pluginRunCommand('az', ['version'], {});
      p.stdout?.on('data', data => console.log('az stdout:', data));
      p.stderr?.on('data', data => console.log('az stderr:', data));
      p.on('exit', exit => console.log('az exit code:', exit));
    }}
  >
    az version
  </Button>
));
