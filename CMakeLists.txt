cmake_minimum_required(VERSION 3.20)
project(quake3_wasm LANGUAGES C CXX)

if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "This target is browser-only. Configure it through ./build-web.sh.")
endif()

set(CMAKE_C_STANDARD 99)
set(CMAKE_CXX_STANDARD 98)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(RENDERER_SOURCES
  code/renderer/tr_animation.c code/renderer/tr_backend.c code/renderer/tr_bsp.c
  code/renderer/tr_cmds.c code/renderer/tr_curve.c code/renderer/tr_flares.c
  code/renderer/tr_font.c code/renderer/tr_image.c code/renderer/tr_init.c
  code/renderer/tr_light.c code/renderer/tr_main.c code/renderer/tr_marks.c
  code/renderer/tr_mesh.c code/renderer/tr_model.c code/renderer/tr_noise.c
  code/renderer/tr_scene.c code/renderer/tr_shade.c code/renderer/tr_shade_calc.c
  code/renderer/tr_shader.c code/renderer/tr_shadows.c code/renderer/tr_sky.c
  code/renderer/tr_surface.c code/renderer/tr_world.c)

list(APPEND RENDERER_SOURCES code/renderer/tr_webgl.c)

set(CLIENT_SOURCES
  code/client/cl_cgame.c code/client/cl_cin.c code/client/cl_console.c
  code/client/cl_input.c code/client/cl_keys.c code/client/cl_main.c
  code/client/cl_net_chan.c code/client/cl_parse.c code/client/cl_scrn.c
  code/client/cl_ui.c code/client/snd_adpcm.c code/client/snd_dma.c
  code/client/snd_mem.c code/client/snd_mix.c code/client/snd_wavelet.c)

set(COMMON_SOURCES
  code/qcommon/cm_load.c code/qcommon/cm_patch.c code/qcommon/cm_polylib.c
  code/qcommon/cm_test.c code/qcommon/cm_trace.c code/qcommon/cmd.c
  code/qcommon/common.c code/qcommon/cvar.c code/qcommon/files.c
  code/qcommon/md4.c code/qcommon/msg.c code/qcommon/net_chan.c
  code/qcommon/huffman.c code/qcommon/unzip.c code/qcommon/vm.c
  code/qcommon/vm_interpreted.c code/game/q_math.c code/game/q_shared.c)

set(SERVER_SOURCES
  code/server/sv_bot.c code/server/sv_ccmds.c code/server/sv_client.c
  code/server/sv_game.c code/server/sv_init.c code/server/sv_main.c
  code/server/sv_net_chan.c code/server/sv_snapshot.c code/server/sv_world.c)

set(BOTLIB_SOURCES
  code/botlib/be_aas_bspq3.c code/botlib/be_aas_cluster.c
  code/botlib/be_aas_debug.c code/botlib/be_aas_entity.c
  code/botlib/be_aas_file.c code/botlib/be_aas_main.c
  code/botlib/be_aas_move.c code/botlib/be_aas_optimize.c
  code/botlib/be_aas_reach.c code/botlib/be_aas_route.c
  code/botlib/be_aas_routealt.c code/botlib/be_aas_sample.c
  code/botlib/be_ai_char.c code/botlib/be_ai_chat.c code/botlib/be_ai_gen.c
  code/botlib/be_ai_goal.c code/botlib/be_ai_move.c code/botlib/be_ai_weap.c
  code/botlib/be_ai_weight.c code/botlib/be_ea.c code/botlib/be_interface.c
  code/botlib/l_crc.c code/botlib/l_libvar.c code/botlib/l_log.c
  code/botlib/l_memory.c code/botlib/l_precomp.c code/botlib/l_script.c
  code/botlib/l_struct.c)

set(JPEG_SOURCES
  code/jpeg-6/jcapimin.c code/jpeg-6/jchuff.c code/jpeg-6/jcinit.c
  code/jpeg-6/jccoefct.c code/jpeg-6/jccolor.c code/jpeg-6/jfdctflt.c
  code/jpeg-6/jcdctmgr.c code/jpeg-6/jcphuff.c code/jpeg-6/jcmainct.c
  code/jpeg-6/jcmarker.c code/jpeg-6/jcmaster.c code/jpeg-6/jcomapi.c
  code/jpeg-6/jcparam.c code/jpeg-6/jcprepct.c code/jpeg-6/jcsample.c
  code/jpeg-6/jdapimin.c code/jpeg-6/jdapistd.c code/jpeg-6/jdatasrc.c
  code/jpeg-6/jdcoefct.c code/jpeg-6/jdcolor.c code/jpeg-6/jddctmgr.c
  code/jpeg-6/jdhuff.c code/jpeg-6/jdinput.c code/jpeg-6/jdmainct.c
  code/jpeg-6/jdmarker.c code/jpeg-6/jdmaster.c code/jpeg-6/jdpostct.c
  code/jpeg-6/jdsample.c code/jpeg-6/jdtrans.c code/jpeg-6/jerror.c
  code/jpeg-6/jidctflt.c code/jpeg-6/jmemmgr.c code/jpeg-6/jmemnobs.c
  code/jpeg-6/jutils.c)

set(SPLINE_SOURCES
  code/splines/math_angles.cpp code/splines/math_matrix.cpp
  code/splines/math_quaternion.cpp code/splines/math_vector.cpp
  code/splines/q_parse.cpp code/splines/q_shared.cpp code/splines/splines.cpp
  code/splines/util_str.cpp)

add_library(quake3-splines STATIC ${SPLINE_SOURCES})
target_include_directories(quake3-splines PRIVATE code/splines code/game code/qcommon)
target_compile_options(quake3-splines PRIVATE -Wno-deprecated-writable-strings)

add_executable(quake3-web
  ${RENDERER_SOURCES} ${CLIENT_SOURCES} ${COMMON_SOURCES} ${SERVER_SOURCES}
  ${BOTLIB_SOURCES} ${JPEG_SOURCES}
  code/web/web_main.c code/web/web_sys.c code/web/web_net.c
  code/web/web_glimp.c code/web/web_input.c code/web/web_snddma.c)

target_link_libraries(quake3-web PRIVATE quake3-splines)

target_include_directories(quake3-web PRIVATE
  code code/game code/qcommon code/client code/renderer code/server
  code/botlib code/jpeg-6 code/splines)
target_compile_definitions(quake3-web PRIVATE C_ONLY=1)
set_source_files_properties(${BOTLIB_SOURCES} PROPERTIES COMPILE_DEFINITIONS BOTLIB)
target_compile_options(quake3-web PRIVATE
  "SHELL:-s USE_SDL=2"
  -Wall -Wextra -Wno-unused-parameter -Wno-sign-compare
  -Wno-missing-field-initializers -fno-strict-aliasing)

set_target_properties(quake3-web PROPERTIES
  OUTPUT_NAME "quake3"
  SUFFIX ".js"
  LINK_DEPENDS "${CMAKE_SOURCE_DIR}/web/pre.js")

target_link_options(quake3-web PRIVATE
  "SHELL:-s USE_SDL=2"
  "SHELL:-s USE_ZLIB=1"
  "SHELL:-s USE_WEBGL2=1"
  "SHELL:-s MIN_WEBGL_VERSION=1"
  "SHELL:-s MAX_WEBGL_VERSION=2"
  "SHELL:-s LEGACY_GL_EMULATION=1"
  "SHELL:-s ALLOW_MEMORY_GROWTH=1"
  "SHELL:-s INITIAL_MEMORY=268435456"
  "SHELL:-s MAXIMUM_MEMORY=1073741824"
  # The native shader parser and renderer initialization use large automatic
  # buffers. Emscripten's default stack overflows while loading retail shader
  # scripts even though the heap has ample room.
  "SHELL:-s STACK_SIZE=16777216"
  "SHELL:-s MODULARIZE=1"
  "SHELL:-s EXPORT_NAME=createQuake3Module"
  "SHELL:-s EXIT_RUNTIME=0"
  "SHELL:-s ASSERTIONS=1"
  "SHELL:-s ENVIRONMENT=web"
  "SHELL:-s EXPORTED_RUNTIME_METHODS=['FS','IDBFS']"
  "SHELL:-lidbfs.js"
  "SHELL:--pre-js ${CMAKE_SOURCE_DIR}/web/pre.js")

configure_file(web/index.html index.html COPYONLY)
configure_file(web/launcher.js launcher.js COPYONLY)
configure_file(web/assets.js assets.js COPYONLY)
configure_file(web/style.css style.css COPYONLY)
configure_file(web/pak-manifest.json pak-manifest.json COPYONLY)
