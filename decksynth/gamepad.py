"""Optional, opt-in native Steam Deck controller polling via installed SDL2.

The gamepad is off by default because Steam's Desktop Mode input mapping can
also generate mouse/keyboard events. Do not interfere with Steam Input unless
the musician explicitly enables controller control in the DeckSynth UI.
"""
import ctypes as C

SDL_INIT_GAMECONTROLLER = 0x00002000
BUTTONS = {
    'A': 0, 'B': 1, 'X': 2, 'Y': 3, 'BACK': 4, 'START': 6,
    'L1': 9, 'R1': 10, 'UP': 11, 'DOWN': 12, 'LEFT': 13, 'RIGHT': 14,
}

class Gamepad:
    def __init__(self):
        s = C.CDLL('libSDL2-2.0.so.0')
        s.SDL_InitSubSystem.argtypes = [C.c_uint32]
        s.SDL_InitSubSystem.restype = C.c_int
        s.SDL_QuitSubSystem.argtypes = [C.c_uint32]
        s.SDL_NumJoysticks.restype = C.c_int
        s.SDL_IsGameController.argtypes = [C.c_int]
        s.SDL_IsGameController.restype = C.c_int
        s.SDL_JoystickNameForIndex.argtypes = [C.c_int]
        s.SDL_JoystickNameForIndex.restype = C.c_char_p
        s.SDL_GameControllerOpen.argtypes = [C.c_int]
        s.SDL_GameControllerOpen.restype = C.c_void_p
        s.SDL_GameControllerClose.argtypes = [C.c_void_p]
        s.SDL_GameControllerUpdate.argtypes = []
        s.SDL_GameControllerGetButton.argtypes = [C.c_void_p, C.c_int]
        s.SDL_GameControllerGetButton.restype = C.c_uint8
        s.SDL_GameControllerGetAttached.argtypes = [C.c_void_p]
        s.SDL_GameControllerGetAttached.restype = C.c_int
        s.SDL_GetError.restype = C.c_char_p
        if s.SDL_InitSubSystem(SDL_INIT_GAMECONTROLLER) != 0:
            raise RuntimeError('SDL gamepad unavailable: '+s.SDL_GetError().decode(errors='replace'))
        self.lib = s
        self.controller = None
        self.name = None
        try:
            matches = [(i, (s.SDL_JoystickNameForIndex(i) or b'').decode(errors='replace'))
                       for i in range(max(0,s.SDL_NumJoysticks()))
                       if s.SDL_IsGameController(i)]
            if not matches:
                raise RuntimeError('No Steam Deck gamepad detected')
            idx, self.name = next(((i,n) for i,n in matches if 'Steam Deck' in n), matches[0])
            self.controller = s.SDL_GameControllerOpen(idx)
            if not self.controller:
                raise RuntimeError('Cannot open '+self.name+': '+s.SDL_GetError().decode(errors='replace'))
            s.SDL_GameControllerUpdate()
            self.previous = {label: bool(s.SDL_GameControllerGetButton(self.controller,code))
                             for label,code in BUTTONS.items()}
        except Exception:
            self.close()
            raise

    def rising_buttons(self):
        if not self.controller or not self.lib.SDL_GameControllerGetAttached(self.controller):
            raise RuntimeError('Gamepad disconnected')
        self.lib.SDL_GameControllerUpdate()
        pressed = []
        for label, code in BUTTONS.items():
            down = bool(self.lib.SDL_GameControllerGetButton(self.controller,code))
            if down and not self.previous[label]:
                pressed.append(label)
            self.previous[label] = down
        return pressed

    def close(self):
        if getattr(self,'controller',None):
            self.lib.SDL_GameControllerClose(self.controller)
            self.controller = None
        if getattr(self,'lib',None):
            self.lib.SDL_QuitSubSystem(SDL_INIT_GAMECONTROLLER)
            self.lib = None
