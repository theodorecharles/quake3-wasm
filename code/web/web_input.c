#include "../client/client.h"
#include "../ui/keycodes.h"
#include "web_local.h"

#include <SDL.h>

static qboolean mouseActive;

static int Web_MapKey(SDL_Keycode key) {
	switch (key) {
	case SDLK_TAB: return K_TAB;
	case SDLK_RETURN: return K_ENTER;
	case SDLK_ESCAPE: return K_ESCAPE;
	case SDLK_SPACE: return K_SPACE;
	case SDLK_BACKSPACE: return K_BACKSPACE;
	case SDLK_CAPSLOCK: return K_CAPSLOCK;
	case SDLK_PAUSE: return K_PAUSE;
	case SDLK_UP: return K_UPARROW;
	case SDLK_DOWN: return K_DOWNARROW;
	case SDLK_LEFT: return K_LEFTARROW;
	case SDLK_RIGHT: return K_RIGHTARROW;
	case SDLK_LALT: case SDLK_RALT: return K_ALT;
	case SDLK_LCTRL: case SDLK_RCTRL: return K_CTRL;
	case SDLK_LSHIFT: case SDLK_RSHIFT: return K_SHIFT;
	case SDLK_INSERT: return K_INS;
	case SDLK_DELETE: return K_DEL;
	case SDLK_PAGEDOWN: return K_PGDN;
	case SDLK_PAGEUP: return K_PGUP;
	case SDLK_HOME: return K_HOME;
	case SDLK_END: return K_END;
	case SDLK_F1: return K_F1;
	case SDLK_F2: return K_F2;
	case SDLK_F3: return K_F3;
	case SDLK_F4: return K_F4;
	case SDLK_F5: return K_F5;
	case SDLK_F6: return K_F6;
	case SDLK_F7: return K_F7;
	case SDLK_F8: return K_F8;
	case SDLK_F9: return K_F9;
	case SDLK_F10: return K_F10;
	case SDLK_F11: return K_F11;
	case SDLK_F12: return K_F12;
	case SDLK_KP_ENTER: return K_KP_ENTER;
	case SDLK_KP_DIVIDE: return K_KP_SLASH;
	case SDLK_KP_MINUS: return K_KP_MINUS;
	case SDLK_KP_PLUS: return K_KP_PLUS;
	case SDLK_KP_MULTIPLY: return K_KP_STAR;
	default:
		if (key >= 32 && key < 127) {
			return tolower((int)key);
		}
		return 0;
	}
}

void IN_ActivateMouse(void) {
	if (!mouseActive && SDL_SetRelativeMouseMode(SDL_TRUE) == 0) {
		mouseActive = qtrue;
	}
}

void IN_DeactivateMouse(void) {
	if (mouseActive) {
		SDL_SetRelativeMouseMode(SDL_FALSE);
		mouseActive = qfalse;
	}
}

void IN_Init(void) {
	SDL_StartTextInput();
	mouseActive = qfalse;
	Com_Printf("[quake3-wasm] SDL keyboard and mouse initialized\n");
}

void IN_Shutdown(void) {
	IN_DeactivateMouse();
	SDL_StopTextInput();
}

void IN_Activate(void) {}

void IN_Frame(void) {
	if (cls.state == CA_ACTIVE && Key_GetCatcher() == 0) {
		IN_ActivateMouse();
	} else {
		IN_DeactivateMouse();
	}
}

void Sys_SendKeyEvents(void) {
	SDL_Event event;
	while (SDL_PollEvent(&event)) {
		switch (event.type) {
		case SDL_KEYDOWN:
		case SDL_KEYUP: {
			int key = Web_MapKey(event.key.keysym.sym);
			if (key && !event.key.repeat) {
				Sys_QueEvent(0, SE_KEY, key, event.type == SDL_KEYDOWN, 0, NULL);
			}
			break;
		}
		case SDL_TEXTINPUT: {
			const unsigned char *text = (const unsigned char *)event.text.text;
			while (*text) {
				if (*text < 128) {
					Sys_QueEvent(0, SE_CHAR, *text, 0, 0, NULL);
				}
				++text;
			}
			break;
		}
		case SDL_MOUSEMOTION:
			if (mouseActive && (event.motion.xrel || event.motion.yrel)) {
				Sys_QueEvent(0, SE_MOUSE, event.motion.xrel, event.motion.yrel, 0, NULL);
			}
			break;
		case SDL_MOUSEBUTTONDOWN:
		case SDL_MOUSEBUTTONUP:
			if (event.button.button >= SDL_BUTTON_LEFT && event.button.button <= SDL_BUTTON_X2) {
				Sys_QueEvent(0, SE_KEY, K_MOUSE1 + event.button.button - SDL_BUTTON_LEFT,
					event.type == SDL_MOUSEBUTTONDOWN, 0, NULL);
			}
			break;
		case SDL_MOUSEWHEEL: {
			int key = event.wheel.y > 0 ? K_MWHEELUP : K_MWHEELDOWN;
			Sys_QueEvent(0, SE_KEY, key, qtrue, 0, NULL);
			Sys_QueEvent(0, SE_KEY, key, qfalse, 0, NULL);
			break;
		}
		case SDL_QUIT:
			Cbuf_AddText("quit\n");
			break;
		default:
			break;
		}
	}
}
