#include "../renderer/tr_local.h"

#include <SDL.h>

static SDL_Window *webWindow;
static SDL_GLContext webContext;

static void APIENTRY Web_MultiTexCoord2f(GLenum texture, GLfloat s, GLfloat t) {
	// The WebGL path uses client texture-coordinate arrays. This compatibility
	// callback is retained only for the renderer's conformance/debug path.
	if (texture == 0 || texture == GL_TEXTURE0_ARB) {
		qglTexCoord2f(s, t);
	}
}

static void GLimp_CopyString(char *destination, size_t size, GLenum token) {
	const GLubyte *value = qglGetString(token);
	Q_strncpyz(destination, value ? (const char *)value : "unknown", (int)size);
}

void GLimp_Init(void) {
	int width;
	int height;
	float aspect;
	GLint value;

	if (SDL_Init(SDL_INIT_VIDEO) != 0) {
		ri.Error(ERR_FATAL, "SDL video initialization failed: %s", SDL_GetError());
	}
	if (!R_GetModeInfo(&width, &height, &aspect, r_mode->integer)) {
		ri.Printf(PRINT_WARNING, "Invalid mode %d; using 640x480\n", r_mode->integer);
		width = 640;
		height = 480;
		aspect = 4.0f / 3.0f;
	}

	SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 2);
	SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
	SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
	SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 24);
	SDL_GL_SetAttribute(SDL_GL_STENCIL_SIZE, 8);
	webWindow = SDL_CreateWindow("Quake III Arena", SDL_WINDOWPOS_CENTERED,
		SDL_WINDOWPOS_CENTERED, width, height, SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE);
	if (!webWindow) {
		ri.Error(ERR_FATAL, "SDL window creation failed: %s", SDL_GetError());
	}
	webContext = SDL_GL_CreateContext(webWindow);
	if (!webContext) {
		ri.Error(ERR_FATAL, "WebGL context creation failed: %s", SDL_GetError());
	}
	SDL_GL_SetSwapInterval(r_swapInterval->integer ? 1 : 0);

	glConfig.vidWidth = width;
	glConfig.vidHeight = height;
	glConfig.windowAspect = aspect;
	glConfig.colorBits = 24;
	glConfig.depthBits = 24;
	glConfig.stencilBits = 8;
	glConfig.isFullscreen = qfalse;
	glConfig.stereoEnabled = qfalse;
	glConfig.smpActive = qfalse;
	glConfig.deviceSupportsGamma = qfalse;
	glConfig.driverType = GLDRV_ICD;
	glConfig.hardwareType = GLHW_GENERIC;
	glConfig.textureCompression = TC_NONE;
	glConfig.textureEnvAddAvailable = qtrue;
	glConfig.displayFrequency = 0;

	GLimp_CopyString(glConfig.vendor_string, sizeof(glConfig.vendor_string), GL_VENDOR);
	GLimp_CopyString(glConfig.renderer_string, sizeof(glConfig.renderer_string), GL_RENDERER);
	GLimp_CopyString(glConfig.version_string, sizeof(glConfig.version_string), GL_VERSION);
	GLimp_CopyString(glConfig.extensions_string, sizeof(glConfig.extensions_string), GL_EXTENSIONS);
	qglGetIntegerv(GL_MAX_TEXTURE_SIZE, &value);
	glConfig.maxTextureSize = value;
	qglGetIntegerv(GL_MAX_TEXTURE_IMAGE_UNITS, &value);
	glConfig.maxActiveTextures = value > 1 ? value : 1;

	qglMultiTexCoord2fARB = Web_MultiTexCoord2f;
	qglActiveTextureARB = glActiveTexture;
	qglClientActiveTextureARB = glClientActiveTexture;
	qglLockArraysEXT = NULL;
	qglUnlockArraysEXT = NULL;

	ri.Printf(PRINT_ALL, "[quake3-wasm] WebGL canvas %dx%d\n", width, height);
}

void GLimp_Shutdown(void) {
	if (webContext) {
		SDL_GL_DeleteContext(webContext);
		webContext = NULL;
	}
	if (webWindow) {
		SDL_DestroyWindow(webWindow);
		webWindow = NULL;
	}
	SDL_QuitSubSystem(SDL_INIT_VIDEO);
}

void GLimp_EndFrame(void) {
	if (r_swapInterval->modified) {
		SDL_GL_SetSwapInterval(r_swapInterval->integer ? 1 : 0);
		r_swapInterval->modified = qfalse;
	}
	SDL_GL_SwapWindow(webWindow);
}

void GLimp_LogComment(char *comment) { (void)comment; }
void GLimp_SetGamma(unsigned char red[256], unsigned char green[256], unsigned char blue[256]) {
	(void)red; (void)green; (void)blue;
}
qboolean GLimp_SpawnRenderThread(void (*function)(void)) { (void)function; return qfalse; }
void *GLimp_RendererSleep(void) { return NULL; }
void GLimp_FrontEndSleep(void) {}
void GLimp_WakeRenderer(void *data) { (void)data; }
