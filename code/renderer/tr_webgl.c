/*
 * GLES2/WebGL submission for the original Quake III renderer.
 *
 * The native renderer still computes every shader stage, color, texture
 * coordinate and transform. Only its desktop-GL client-array submission is
 * replaced with a compact programmable pipeline suitable for the browser.
 */

#include "tr_local.h"

#ifdef __EMSCRIPTEN__

#include <stddef.h>

extern GLuint glCreateShader(GLenum type);
extern void glShaderSource(GLuint shader, GLsizei count,
	const char *const *string, const GLint *length);
extern void glCompileShader(GLuint shader);
extern void glGetShaderiv(GLuint shader, GLenum pname, GLint *params);
extern void glGetShaderInfoLog(GLuint shader, GLsizei bufSize,
	GLsizei *length, char *infoLog);
extern GLuint glCreateProgram(void);
extern void glAttachShader(GLuint program, GLuint shader);
extern void glBindAttribLocation(GLuint program, GLuint index, const char *name);
extern void glLinkProgram(GLuint program);
extern void glGetProgramiv(GLuint program, GLenum pname, GLint *params);
extern void glGetProgramInfoLog(GLuint program, GLsizei bufSize,
	GLsizei *length, char *infoLog);
extern void glUseProgram(GLuint program);
extern GLint glGetUniformLocation(GLuint program, const char *name);
extern void glUniformMatrix4fv(GLint location, GLsizei count,
	GLboolean transpose, const GLfloat *value);
extern void glUniform1i(GLint location, GLint value);
extern void glGenBuffers(GLsizei n, GLuint *buffers);
extern void glBindBuffer(GLenum target, GLuint buffer);
extern void glBufferData(GLenum target, long size, const void *data, GLenum usage);
extern void glEnableVertexAttribArray(GLuint index);
extern void glVertexAttribPointer(GLuint index, GLint size, GLenum type,
	GLboolean normalized, GLsizei stride, const void *pointer);

typedef struct {
	float xyz[3];
	float uv[2];
	byte color[4];
} webVertex_t;

static GLuint webProgram;
static GLuint webVbo;
static GLint webMvp;
static GLint webTexture;
static GLint webAlphaTest;
static qboolean webReady;
static qboolean webFailed;
static float webOrtho[16];

static void Web_MatrixIdentity(float *m) {
	Com_Memset(m, 0, sizeof(float) * 16);
	m[0] = m[5] = m[10] = m[15] = 1.0f;
}

static void Web_MatrixOrtho(float *m, float l, float r, float b, float t,
	float n, float f) {
	Web_MatrixIdentity(m);
	m[0] = 2.0f / (r - l);
	m[5] = 2.0f / (t - b);
	m[10] = -2.0f / (f - n);
	m[12] = -(r + l) / (r - l);
	m[13] = -(t + b) / (t - b);
	m[14] = -(f + n) / (f - n);
}

static void Web_MatrixMultiply(float *out, const float *a, const float *b) {
	float tmp[16];
	int i, j, k;
	for (i = 0; i < 4; ++i) {
		for (j = 0; j < 4; ++j) {
			float value = 0.0f;
			for (k = 0; k < 4; ++k) {
				value += a[k * 4 + j] * b[i * 4 + k];
			}
			tmp[i * 4 + j] = value;
		}
	}
	Com_Memcpy(out, tmp, sizeof(tmp));
}

static GLuint Web_CompileShader(GLenum type, const char *source) {
	GLuint shader = glCreateShader(type);
	GLint ok = 0;
	glShaderSource(shader, 1, &source, NULL);
	glCompileShader(shader);
	glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
	if (!ok) {
		char log[512];
		log[0] = '\0';
		glGetShaderInfoLog(shader, sizeof(log) - 1, NULL, log);
		ri.Printf(PRINT_WARNING,
			"[quake3-wasm] WebGL shader compile failed: %s\n", log);
		return 0;
	}
	return shader;
}

static void Web_InitProgram(void) {
	static const char *vertexSource =
		"attribute vec3 a_position;\n"
		"attribute vec2 a_texcoord;\n"
		"attribute vec4 a_color;\n"
		"uniform mat4 u_mvp;\n"
		"varying highp vec2 v_texcoord;\n"
		"varying lowp vec4 v_color;\n"
		"void main(void) {\n"
		"  gl_Position = u_mvp * vec4(a_position, 1.0);\n"
		"  v_texcoord = a_texcoord;\n"
		"  v_color = a_color;\n"
		"}\n";
	static const char *fragmentSource =
		"precision mediump float;\n"
		"uniform sampler2D u_texture;\n"
		"uniform int u_alpha_test;\n"
		"varying highp vec2 v_texcoord;\n"
		"varying lowp vec4 v_color;\n"
		"void main(void) {\n"
		"  vec4 color = texture2D(u_texture, v_texcoord) * v_color;\n"
		"  if (u_alpha_test == 1 && color.a <= 0.0) discard;\n"
		"  if (u_alpha_test == 2 && color.a >= 0.5) discard;\n"
		"  if (u_alpha_test == 3 && color.a < 0.5) discard;\n"
		"  gl_FragColor = color;\n"
		"}\n";
	GLuint vertexShader;
	GLuint fragmentShader;
	GLint ok = 0;

	if (webReady || webFailed) {
		return;
	}
	vertexShader = Web_CompileShader(GL_VERTEX_SHADER, vertexSource);
	fragmentShader = Web_CompileShader(GL_FRAGMENT_SHADER, fragmentSource);
	if (!vertexShader || !fragmentShader) {
		webFailed = qtrue;
		return;
	}
	webProgram = glCreateProgram();
	glAttachShader(webProgram, vertexShader);
	glAttachShader(webProgram, fragmentShader);
	glBindAttribLocation(webProgram, 0, "a_position");
	glBindAttribLocation(webProgram, 1, "a_texcoord");
	glBindAttribLocation(webProgram, 2, "a_color");
	glLinkProgram(webProgram);
	glGetProgramiv(webProgram, GL_LINK_STATUS, &ok);
	if (!ok) {
		char log[512];
		log[0] = '\0';
		glGetProgramInfoLog(webProgram, sizeof(log) - 1, NULL, log);
		ri.Printf(PRINT_WARNING,
			"[quake3-wasm] WebGL program link failed: %s\n", log);
		webFailed = qtrue;
		return;
	}
	webMvp = glGetUniformLocation(webProgram, "u_mvp");
	webTexture = glGetUniformLocation(webProgram, "u_texture");
	webAlphaTest = glGetUniformLocation(webProgram, "u_alpha_test");
	glGenBuffers(1, &webVbo);
	webReady = qtrue;
	ri.Printf(PRINT_ALL,
		"[quake3-wasm] native renderer WebGL submit path ready\n");
}

void R_WebGL_Set2D(void) {
	int width = glConfig.vidWidth > 0 ? glConfig.vidWidth : 640;
	int height = glConfig.vidHeight > 0 ? glConfig.vidHeight : 480;
	Web_MatrixOrtho(webOrtho, 0.0f, (float)width, (float)height, 0.0f,
		0.0f, 1.0f);
}

static int Web_AlphaTest(void) {
	switch (glState.glStateBits & GLS_ATEST_BITS) {
	case GLS_ATEST_GT_0: return 1;
	case GLS_ATEST_LT_80: return 2;
	case GLS_ATEST_GE_80: return 3;
	default: return 0;
	}
}

void R_WebGL_DrawTess(int numIndexes, const glIndex_t *indexes) {
	static webVertex_t packed[SHADER_MAX_INDEXES];
	float mvp[16];
	int i;

	if (numIndexes < 3 || numIndexes > SHADER_MAX_INDEXES
		|| tess.numVertexes < 3) {
		return;
	}
	Web_InitProgram();
	if (!webReady) {
		return;
	}
	if (backEnd.projection2D) {
		Com_Memcpy(mvp, webOrtho, sizeof(mvp));
	} else {
		Web_MatrixMultiply(mvp, backEnd.viewParms.projectionMatrix,
			backEnd.or.modelMatrix);
	}
	for (i = 0; i < numIndexes; ++i) {
		unsigned index = indexes[i];
		if (index >= (unsigned)tess.numVertexes) {
			return;
		}
		VectorCopy(tess.xyz[index], packed[i].xyz);
		packed[i].uv[0] = tess.svars.texcoords[0][index][0];
		packed[i].uv[1] = tess.svars.texcoords[0][index][1];
		Com_Memcpy(packed[i].color, tess.svars.colors[index], 4);
	}

	glUseProgram(webProgram);
	glUniformMatrix4fv(webMvp, 1, GL_FALSE, mvp);
	glUniform1i(webTexture, 0);
	glUniform1i(webAlphaTest, Web_AlphaTest());
	glBindBuffer(GL_ARRAY_BUFFER, webVbo);
	glBufferData(GL_ARRAY_BUFFER, (long)(sizeof(webVertex_t) * numIndexes),
		packed, GL_STREAM_DRAW);
	glEnableVertexAttribArray(0);
	glEnableVertexAttribArray(1);
	glEnableVertexAttribArray(2);
	glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(webVertex_t),
		(const void *)offsetof(webVertex_t, xyz));
	glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, sizeof(webVertex_t),
		(const void *)offsetof(webVertex_t, uv));
	glVertexAttribPointer(2, 4, GL_UNSIGNED_BYTE, GL_TRUE,
		sizeof(webVertex_t), (const void *)offsetof(webVertex_t, color));
	glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, 0);
	glDrawArrays(GL_TRIANGLES, 0, numIndexes);
}

#endif
