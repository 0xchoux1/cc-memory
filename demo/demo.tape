# cc-memory Demo GIF
# Usage: vhs demo/demo.tape

# Settings
Output demo/cc-memory-demo.gif
Set FontSize 14
Set Width 900
Set Height 500
Set Theme "Catppuccin Mocha"
Set TypingSpeed 50ms
Set Padding 20

# Title
Sleep 500ms

# Show cc-memory help
Type "cc-memory help"
Sleep 300ms
Enter
Sleep 2s

# Run setup with dry-run
Type "cc-memory setup --dry-run"
Sleep 300ms
Enter
Sleep 3s

# Run doctor
Type "cc-memory doctor"
Sleep 300ms
Enter
Sleep 2s

# Show status
Type "cc-memory status"
Sleep 300ms
Enter
Sleep 2s

# End
Sleep 1s
